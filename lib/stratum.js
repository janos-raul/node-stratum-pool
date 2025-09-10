/**
 * @module stratum
 * @description Implements the Stratum mining protocol for cryptocurrency pools.
 * Handles client connections, message validation, and mining operations.
 */

var net = require('net');
var events = require('events');

var util = require('./util.js');

// Constants for input validation
var MAX_STRING_LENGTH = 1024;
var MAX_ARRAY_LENGTH = 100;
var ALLOWED_METHODS = [
    'mining.subscribe',
    'mining.authorize', 
    'mining.submit',
    'mining.get_transactions',
    'mining.configure',
    'mining.extranonce.subscribe',
    'mining.set_version_mask',
    'ping'
];


/**
 * Generates unique subscription IDs for Stratum clients.
 * The ID consists of a fixed prefix followed by a counter.
 * 
 * @class SubscriptionCounter
 * @private
 */
var SubscriptionCounter = function(){
    var count = 0;
    var padding = 'deadbeefcafebabe';
    return {
        next: function(){
            count++;
            if (Number.MAX_VALUE === count) count = 0;
            return padding + util.packInt64LE(count).toString('hex');
        }
    };
};


/**
 * Represents a connected Stratum mining client.
 * Handles all communication with individual miners.
 * 
 * @class StratumClient
 * @extends {EventEmitter}
 * @param {Object} options - Client configuration
 * @param {net.Socket} options.socket - Network socket for the client
 * @param {Object} options.banning - Ban configuration settings
 * @param {string} options.subscriptionId - Unique subscription ID
 * @param {Object} options.authorizeFn - Function to authorize workers
 * 
 * @fires StratumClient#subscription - When client subscribes
 * @fires StratumClient#submit - When client submits a share
 * @fires StratumClient#malformedMessage - On invalid message format
 * @fires StratumClient#socketError - On socket errors
 * @fires StratumClient#socketTimeout - On socket timeout
 * @fires StratumClient#socketDisconnect - When socket disconnects
 * @fires StratumClient#triggerBan - When client should be banned
 */
var StratumClient = function(options){
    var pendingDifficulty = null;
    
    //private members
    this.socket = options.socket;
    this.remoteAddress = options.socket.remoteAddress;
    var banning = options.banning;
    var _this = this;
    this.lastActivity = Date.now();
    
    this.initialDifficulty = -1;
    this.minimumDifficulty = -1;
    this.isSoloMining = false;
    this.shares = {valid: 0, invalid: 0};
    
    this.asicboost = false;                    // Client supports AsicBoost
    this.versionMask = null;                   // Negotiated version rolling mask
    this.versionRolling = false;               // Version rolling enabled
    this.negotiatedExtensions = {};           // Store all negotiated capabilities
    this.supportsExtranonceSubscribe = false; // Extranonce subscription support
	
	setupSocket();
    
    var considerBan = (!banning || !banning.enabled) ? function(){ return false } : function(shareValid){
        if (shareValid === true) _this.shares.valid++;
        else _this.shares.invalid++;
        var totalShares = _this.shares.valid + _this.shares.invalid;
        if (totalShares >= banning.checkThreshold){
            var percentBad = (_this.shares.invalid / totalShares) * 100;
            if (percentBad < banning.invalidPercent)
                _this.shares = {valid: 0, invalid: 0};
            else {
                _this.emit('triggerBan', _this.shares.invalid + ' out of the last ' + totalShares + ' shares were invalid');
                _this.socket.destroy();
                return true;
            }
        }
        return false;
    };

    /**
     * Validates a stratum message
     * @param {Object} message Stratum message
     * @returns {Object} Validation result
     * @property {Boolean} valid True if the message is valid
     * @property {String|undefined} error Error message if the message is invalid
     */
    function validateMessage(message){
        // Basic structure validation
        if (!message || typeof message !== 'object') {
            return { valid: false, error: 'Invalid message format' };
        }

        // Validate method
        if (!message.method || typeof message.method !== 'string') {
            return { valid: false, error: 'Missing or invalid method' };
        }

        if (!ALLOWED_METHODS.includes(message.method)) {
            return { valid: false, error: 'Unknown method: ' + message.method };
        }

        // Validate id
        if (message.id !== null && message.id !== undefined) {
            if (typeof message.id !== 'string' && typeof message.id !== 'number') {
                return { valid: false, error: 'Invalid message id type' };
            }
            if (typeof message.id === 'string' && message.id.length > MAX_STRING_LENGTH) {
                return { valid: false, error: 'Message id too long' };
            }
        }

        // Validate params
        if (message.params !== undefined) {
            if (!Array.isArray(message.params)) {
                return { valid: false, error: 'Params must be an array' };
            }
            if (message.params.length > MAX_ARRAY_LENGTH) {
                return { valid: false, error: 'Too many parameters' };
            }

            // Validate each parameter
            for (var i = 0; i < message.params.length; i++) {
                var param = message.params[i];

                // Check string parameters
                if (typeof param === 'string') {
                    if (param.length > MAX_STRING_LENGTH) {
                        return { valid: false, error: 'Parameter ' + i + ' too long' };
                    }
                    // Check for null bytes or control characters
                    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(param)) {
                        return { valid: false, error: 'Invalid characters in parameter ' + i };
                    }
                }

                // Check arrays
                if (Array.isArray(param) && param.length > MAX_ARRAY_LENGTH) {
                    return { valid: false, error: 'Parameter ' + i + ' array too long' };
                }
            }
        }
if (message.method === 'mining.configure' && message.params) {
    // mining.configure should have exactly 2 parameters: [extensions_array, extension_params_object]
    if (message.params.length !== 2) {
        return { valid: false, error: 'mining.configure requires exactly 2 parameters' };
    }
    
    // First parameter should be array of requested extensions
    if (!Array.isArray(message.params[0])) {
        return { valid: false, error: 'mining.configure first parameter must be array of extensions' };
    }
    
    // Second parameter should be object with extension parameters
    if (message.params[1] && typeof message.params[1] !== 'object') {
        return { valid: false, error: 'mining.configure second parameter must be object' };
    }
}

        return { valid: true };
    }

    /**
     * Handles an incoming Stratum message. Emits a 'unknownStratumMethod'
     * event if the method is not implemented.
     *
     * @param {Object} message - Stratum message object
     * @private
     */
function handleMessage(message){
    //console.log('[Debug] Received message:', message.method, 'from:', _this.remoteAddress);
    //console.log('[WhatsMiner Debug] Method:', message.method, 'on connection:', _this.remoteAddress, 'SubscriptionID:', options.subscriptionId);
    
    switch(message.method){
        case 'mining.subscribe':
            //console.log('[Debug] Calling handleSubscribe');
            handleSubscribe(message);
            break;
        case 'mining.authorize':
           // console.log('[Debug] Calling handleAuthorize');
            handleAuthorize(message, true /*reply to socket*/);
            break;
        case 'mining.submit':
            _this.lastActivity = Date.now();
           // console.log('mining.submit message from miner');
            handleSubmit(message);
            break;
        case 'mining.get_transactions':
            sendJson({
                id     : null,
                result : [],
                error  : true
            });
            break;
        case 'ping':
          //  console.log('ping message from miner');
            _this.lastActivity = Date.now();
            sendJson({
                id: null,
                result: [],
                method: "pong"
            });
            break;
        case 'mining.configure':
          //  console.log('mining.configure message from miner');
            handleConfigure(message);
            break;
        case 'mining.extranonce.subscribe':
          //  console.log('mining.extranonce.subscribe message from miner');
            handleExtraNonceSubscribe(message);
            break;
        case 'mining.set_version_mask':
          //  console.log('mining.set_version_mask message from miner');
            handleSetVersionMask(message);
            break;
		case 'mining.suggest_difficulty':
			// Pool-controlled difficulty - change this value as needed
			var poolManagedDiff = 25000;
			
			var suggestedDiff = message.params[0];
			console.log('[DiffAdjust] Miner', _this.remoteAddress, 'suggested', suggestedDiff, 
						'but pool is using fixed difficulty:', poolManagedDiff);
			
			// Set the pool's chosen difficulty regardless of suggestion
			_this.difficulty = poolManagedDiff;
			
			// Send new difficulty to miner
			sendJson({
				id: null,
				method: "mining.set_difficulty", 
				params: [poolManagedDiff]
			});
			
			// Acknowledge the request
			sendJson({
				id: message.id,
				result: true,
				error: null
			});
			break;
        default:
            _this.emit('unknownStratumMethod', message);
            break;
    }
}
	
function handleSetVersionMask(message) {
    if (!_this.asicboost) {
        sendJson({
            id: message.id,
            result: false,
            error: [20, "AsicBoost not enabled", null]
        });
        return;
    }
    // This would be a response to a pool-initiated version mask update
    // Most implementations don't need this
}
    function handleExtraNonceSubscribe(message) {
        _this.supportsExtranonceSubscribe = true;
        sendJson({
            id: message.id,
            result: true,
            "error": null
        });
    }

    /**
     * Handles a mining.subscribe stratum message
     * @param {Object} message - Stratum message object
     * @fires StratumClient#subscription
     * @private
     */
function handleSubscribe(message){
    //console.log('[Debug] Received mining.subscribe from:', _this.remoteAddress);
    if (!_this.authorized) {
        _this.requestedSubscriptionBeforeAuth = true;
    }
        // NEW: Capture user agent from subscription params
    if (message.params && message.params[0]) {
        _this.userAgent = message.params[0];
        _this.emit('subscriptionReceived', message.params[0]);
        console.log('[MinerState] Captured user agent:', message.params[0]);
    }
    _this.emit('subscription',
        {},
        function(error, extraNonce1, extraNonce2Size){
            if (error){
                sendJson({
                    id: message.id,
                    result: null,
                    error: error
                });
                return;
            }
            
            _this.extraNonce1 = extraNonce1;
            
            // Standard subscription response - same for all clients
            sendJson({
                id: message.id,
                result: [
                    [
                        ["mining.set_difficulty", options.subscriptionId],
                        ["mining.notify", options.subscriptionId]
                    ],
                    extraNonce1,
                    extraNonce2Size
                ],
                error: null
            });
            
           // console.log('[Debug] Sent subscription response to:', _this.remoteAddress);
           // console.log('[Stratum] Client subscribed: ' + _this.remoteAddress + 
           //            ', extraNonce1: ' + extraNonce1);
        }
    );
}

function handleAuthorize(message, replyToSocket) {
    _this.workerName = message.params[0];
    _this.workerPass = message.params[1];
    
    options.authorizeFn(_this.remoteAddress, options.socket.localPort, _this.workerName, _this.workerPass, function (result) {
        _this.authorized = (!result.error && result.authorized);
        
        if (replyToSocket) {
            sendJson({
                id: message.id,
                result: _this.authorized,
                error: result.error
            });
        }
        
        // If the authorizer wants us to close the socket lets do it.
        if (result.disconnect === true) {
            options.socket.destroy();
        } else {
            // Step 1: Clean parameter parsing
            parseWorkerParameters(_this.workerPass);
            
            if (_this.requestedSubscriptionBeforeAuth) {
                if (_this.initialDifficulty > 0) {
                    _this.sendDifficulty(_this.initialDifficulty);
                }
            }
            
            // Emit event for successful authorization
            if (_this.authorized) {
                _this.emit('minerAuthorized', _this.workerName);
                console.log('[MinerState] Miner authorized:', _this.workerName, 'UserAgent:', _this.userAgent);
            }
        }
    });
}

function parseWorkerParameters(passwordString) {
    if (!passwordString || passwordString === 'x') return;
    
    var passwordArgs = passwordString.split(',');
    console.log('[Auth] Parsing parameters:', passwordArgs);
    
    for (var i = 0; i < passwordArgs.length; i++) {
        var param = passwordArgs[i].trim();
        if (param.indexOf('=') === -1) continue;
        
        var key = param.substr(0, param.indexOf('=')).toLowerCase();
        var value = param.substr(param.indexOf('=') + 1);
        
        switch (key) {
            case 'd':
                _this.initialDifficulty = parseInt(value) || -1;
                console.log('[Auth] Set initial difficulty:', _this.initialDifficulty);
                break;
                
            case 'md':
                if (!_this.varDiff) {
                    _this.minimumDifficulty = parseInt(value) || -1;
                    if (options.defaultVarDiff && _this.minimumDifficulty > -1) {
                        _this.varDiff = new varDiff(options.socket.localPort, Object.assign({}, options.defaultVarDiff, {
                            minDiff: _this.minimumDifficulty,
                            maxDiff: 2 * _this.minimumDifficulty
                        }));
                        _this.varDiff.manageClient(_this);
                    }
                }
                console.log('[Auth] Set minimum difficulty:', _this.minimumDifficulty);
                break;
                
            case 'm':
                _this.isSoloMining = value.trim().toLowerCase() === 'solo';  // Keep existing property name
                console.log('[Auth] Solo mining:', _this.isSoloMining);
                break;
                
            default:
                console.log('[Auth] Unknown parameter:', key, '=', value);
                break;
        }
    }
}
    /**
     * Handles mining.configure messages for ASICBoost compatibility.
     * Compatible with AvalonMiner, NiceHash, and other mining services.
     *
     * @param {Object} message - Stratum message with parameters
     * @returns {undefined}
     */
    function handleConfigure(message){
		console.log('[Debug] mining.configure called for client:', _this.getLabel());
		
				// Check if this miner already has AsicBoost configured from a previous connection
		var minerKey = _this.remoteAddress + ':' + (_this.workerName || 'unknown');
		if (_this.asicboost) {
		//	console.log('[MinerState] Miner', minerKey, 'already has AsicBoost enabled, reusing configuration');
			sendJson({
				id: message.id,
				result: _this.negotiatedExtensions || {},
				error: null
			});
			return;
		}
		
        var supported = {};

        // Basic parameter validation
			if (!message.params || !Array.isArray(message.params) || message.params.length < 1) {
				sendJson({
					id: message.id,
					result: null,
					error: [20, "invalid params", null]
				});
				return;
			}

        var extensions = message.params[0];
        var extensionParams = message.params[1] || {};

        // Extensions should be an array
        if (!Array.isArray(extensions)) {
            sendJson({
                id: message.id,
                result: {},
                error: [20, "invalid params", null]
            });
            return;
        }

        // Handle version-rolling extension with proper ASICBoost compatibility
        if (extensions.includes("version-rolling")) {
            // Use a permissive mask that works with most miners
            //var poolVersionMask = 0x1fffe000;  // Standard ASICBoost mask
			var poolVersionMask = options.coin.versionMask ? parseInt(options.coin.versionMask, 16) : 0x3fffe000;
            var clientRequestedMask = extensionParams["version-rolling.mask"];
            var clientMinBitCount = extensionParams["version-rolling.min-bit-count"] || 16;
            
            // Calculate negotiated mask
            var negotiatedMask = poolVersionMask;
            if (clientRequestedMask) {
                var clientMask = parseInt(clientRequestedMask, 16);
                if (!isNaN(clientMask)) {
                    // Use intersection of pool and client masks
                    negotiatedMask = poolVersionMask & clientMask;
                }
            }
            
            // Count bits in negotiated mask
            var bitCount = 0;
            var temp = negotiatedMask;
			while (temp > 0) {
				bitCount += temp & 1;
				temp >>>= 1;
			}
            
            // Only enable if we have enough bits
            if (bitCount >= clientMinBitCount) {
                supported["version-rolling"] = true;
                supported["version-rolling.mask"] = "0x" + negotiatedMask.toString(16);
                supported["version-rolling.min-bit-count"] = bitCount;
                
				_this.asicboost = true;
				_this.versionMask = negotiatedMask;
				_this.versionRolling = true;
				_this.negotiatedExtensions = supported;  // Store all capabilities
                
               // console.log('[Stratum] Client ' + (_this.workerName || 'unknown') + 
               //            ' enabled version-rolling with mask: 0x' + negotiatedMask.toString(16));
		_this.emit('asicboostEnabled', {
        versionMask: negotiatedMask,
        bitCount: bitCount
						});
            } else {
				_this.emit('asicboostDisabled');
                supported["version-rolling"] = false;
                console.log('[Stratum] Client ' + (_this.workerName || 'unknown') + 
                           ' version-rolling disabled - insufficient bits');
            }
        }
		
				// After handleAuthorize completes for non-AsicBoost clients
		if (!_this.asicboost) {
			_this.emit('asicboostDisabled');
		}

        // Process other extensions
        if (extensions.includes("minimum-difficulty")) {
            var minDiff = extensionParams["minimum-difficulty.value"];
            if (minDiff && minDiff > 0) {
                supported["minimum-difficulty"] = true;
                supported["minimum-difficulty.value"] = minDiff;
                _this.minimumDifficulty = minDiff;
            }
        }

        if (extensions.includes("subscribe-extranonce")) {
            supported["subscribe-extranonce"] = true;
            _this.supportsExtranonceSubscribe = true;
        }

        sendJson({
            id: message.id,
            result: supported,
            error: null
        });
    }

    /**
     * Handles mining.submit messages from clients.
     *
     * @param {Object} message - Stratum message with parameters
     *
     * @returns {undefined}
     */
function handleSubmit(message){
//console.log('[Debug] Submit received from:', _this.remoteAddress, 'jobId:', message.params[1]);
    if (!_this.authorized){
        sendJson({
            id    : message.id,
            result: null,
            error : [24, "unauthorized worker", null]
        });
        considerBan(false);
        return;
    }
    if (!_this.extraNonce1){
        sendJson({
            id    : message.id,
            result: null,
            error : [25, "not subscribed", null]
        });
        considerBan(false);
        return;
    }
    
    // Validate submit parameters - now supporting both 5 and 6 parameter formats
    if (!message.params || message.params.length < 5) {
        sendJson({
            id    : message.id,
            result: null,
            error : [20, "missing submit parameters", null]
        });
        considerBan(false);
        return;
    }
    
    // Extract parameters
    var workerName = message.params[0];
    var jobId = message.params[1];
    var extraNonce2 = message.params[2];
    var nTime = message.params[3];
    var nonce = message.params[4];
    var version = message.params[5]; // Optional 6th parameter for AsicBoost
    
    // Validate basic parameters (same as before)
    if (typeof workerName !== 'string' || workerName.length > 128) {
        sendJson({
            id    : message.id,
            result: null,
            error : [20, "invalid worker name", null]
        });
        considerBan(false);
        return;
    }
    
    if (typeof jobId !== 'string' || !jobId.match(/^[0-9a-fA-F]+$/)) {
        sendJson({
            id    : message.id,
            result: null,
            error : [20, "invalid job id", null]
        });
        considerBan(false);
        return;
    }
    
    if (typeof extraNonce2 !== 'string' || !extraNonce2.match(/^[0-9a-fA-F]+$/)) {
        sendJson({
            id    : message.id,
            result: null,
            error : [20, "invalid extranonce2", null]
        });
        considerBan(false);
        return;
    }
    
    if (typeof nTime !== 'string' || !nTime.match(/^[0-9a-fA-F]{8}$/)) {
        sendJson({
            id    : message.id,
            result: null,
            error : [20, "invalid ntime", null]
        });
        considerBan(false);
        return;
    }
    
    if (typeof nonce !== 'string' || !nonce.match(/^[0-9a-fA-F]{8}$/)) {
        sendJson({
            id    : message.id,
            result: null,
            error : [20, "invalid nonce", null]
        });
        considerBan(false);
        return;
    }
    
    // NEW: AsicBoost version parameter validation
    var isAsicBoostSubmit = false;
    var validatedVersion = null;
    
    if (version !== undefined) {
        // Version parameter provided - validate it
        if (typeof version !== 'string' || !version.match(/^[0-9a-fA-F]{8}$/)) {
            sendJson({
                id    : message.id,
                result: null,
                error : [20, "invalid version format", null]
            });
            considerBan(false);
            return;
        }
        
        // Convert hex string to number for validation
        var versionNum = parseInt(version, 16);
        
        // Check if this client negotiated AsicBoost
        if (_this.asicboost && _this.versionMask) {
            // Validate that version bits are within allowed mask
            var maskedVersion = versionNum & _this.versionMask;
            
            // Check if any bits outside the mask are modified from the original job version
            // This would need the original job version to compare against
            // For now, we'll accept any version that only uses bits within the mask
            
            if (maskedVersion !== 0) {
                // AsicBoost submit detected
                isAsicBoostSubmit = true;
                validatedVersion = version;
               // console.log('[Stratum] AsicBoost submit detected from ' + workerName + 
               //            ' - version: 0x' + version + ', mask: 0x' + _this.versionMask.toString(16));
            }
        } else {
            // Client provided version but hasn't negotiated AsicBoost
            console.log('[Stratum] Version parameter provided by non-AsicBoost client: ' + workerName);
            // We can still accept it, just pass it through
            validatedVersion = version;
        }
    } else {
        // No version parameter - traditional submit
        if (_this.asicboost) {
            console.log('[Stratum] Traditional submit from AsicBoost-capable client: ' + workerName);
        }
    }
    
    // Prepare submit data object
    var submitData = {
        name        : workerName,
        jobId       : jobId,
        extraNonce2 : extraNonce2,
        nTime       : nTime,
        nonce       : nonce,
        // NEW: Include version and AsicBoost status
        version     : validatedVersion,
        isAsicBoost : isAsicBoostSubmit,
        versionMask : _this.versionMask,
        // Include client info for debugging/logging
        clientAddress: _this.remoteAddress,
        workerAgent: _this.workerAgent || 'unknown'
    };
    
    // Emit submit event with enhanced data
    _this.emit('submit', submitData, function(error, result){
        if (!considerBan(result)){
            sendJson({
                id: message.id,
                result: result,
                error: error
            });
        }
    });
}

    /**
     * Helper function to send JSON data to the stratum client.
     * Can be given any number of arguments, which are JSON.stringified
     * and written to the socket with a newline appended to each argument.
     * @param {...Object} data - Data to send to the client.
     * @return {undefined}
     */
function sendJson(json){
    var message = JSON.stringify(json) + "\n";
    
    // Add error handling for disconnected clients
    try {
        if (_this.socket && !_this.socket.destroyed) {
            _this.socket.write(message);
        }
    } catch (err) {
        // Client disconnected - emit disconnect event to clean up
        if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
            _this.emit('socketDisconnect');
        } else {
            _this.emit('socketError', err);
        }
    }
}

    /**
     * Set up the socket and associated event listeners.
     *
     * @emits socketDisconnect
     * @emits socketError
     * @emits socketFlooded
     * @emits tcpProxyError
     * @emits malformedMessage
     * @emits checkBan
     */
    function setupSocket(){
        var socket = options.socket;
        var dataBuffer = '';
        socket.setEncoding('utf8');

        if (options.tcpProxyProtocol === true) {
            socket.once('data', function (d) {
                if (d.indexOf('PROXY') === 0) {
                    _this.remoteAddress = d.split(' ')[2];
                }
                else{
                    _this.emit('tcpProxyError', d);
                }
                _this.emit('checkBan');
            });
        }
        else{
            _this.emit('checkBan');
        }
        socket.on('data', function(d){
			//console.log('[Debug] Raw data received from', _this.remoteAddress, ':', d.toString().trim());
    
            dataBuffer += d;
            if (Buffer.byteLength(dataBuffer, 'utf8') > 10240){ //10KB
                dataBuffer = '';
                _this.emit('socketFlooded');
                socket.destroy();
                return;
            }
            if (dataBuffer.indexOf('\n') !== -1){
                var messages = dataBuffer.split('\n');
                var incomplete = dataBuffer.slice(-1) === '\n' ? '' : messages.pop();
                messages.forEach(function(message){
                    if (message === '') return;
					//console.log('[Debug] Processing message:', message);
                    var messageJson;
                    try {
                        messageJson = JSON.parse(message);
						//console.log('[Debug] Parsed JSON:', messageJson);
                    } catch(e) {
						//console.log('[Debug] JSON parse error:', e.message, 'Message:', message);
                        if (options.tcpProxyProtocol !== true || d.indexOf('PROXY') !== 0){
                            _this.emit('malformedMessage', message);
                            socket.destroy();
                        }
                        return;
                    }

                    if (messageJson) {
                        var validation = validateMessage(messageJson);
                        if (!validation.valid) {
							//console.log('[Debug] Message validation failed:', validation.error);
                            _this.emit('malformedMessage', message + ' - ' + validation.error);
                            sendJson({
                                id: messageJson.id || null,
                                result: null,
                                error: [20, validation.error, null]
                            });
                            considerBan(false);
                            return;
                        }
						//console.log('[Debug] Message validated, calling handleMessage');
                        handleMessage(messageJson);
                    }
                });
                dataBuffer = incomplete;
            }
        });
        socket.on('close', function() {
            _this.emit('socketDisconnect');
        });
        socket.on('error', function(err){
            if (err.code !== 'ECONNRESET')
                _this.emit('socketError', err);
        });
    }


    /**
     * Return a string identifying this connection, of the form:
     * <workerName> [<ipAddress>]
     * If the worker is unauthorized, <workerName> will be "(unauthorized)"
     * @return {string}
     */
    this.getLabel = function(){
        return (_this.workerName || '(unauthorized)') + ' [' + _this.remoteAddress + ']';
    };

    /**
     * Queues a new difficulty for the next time the client requests a difficulty.
     * This is useful for when the upstream pool changes its difficulty.
     * @param {number} requestedNewDifficulty - The new difficulty to send to the client
     * @return {boolean} - Always true
     */
    this.enqueueNextDifficulty = function(requestedNewDifficulty) {
        pendingDifficulty = requestedNewDifficulty;
        return true;
    };

    //public members

    /**
     * IF the given difficulty is valid and new it'll send it to the client.
     * returns boolean
     **/
    this.sendDifficulty = function(difficulty){
        if (difficulty === this.difficulty)
            return false;

        _this.previousDifficulty = _this.difficulty;
        _this.difficulty = difficulty;
        sendJson({
            id    : null,
            method: "mining.set_difficulty",
            params: [difficulty]//[512],
        });
        return true;
    };

    /**
     * Send a new mining job to the client.
     *
     * If the client hasn't submitted a share in a while, this will disconnect the client.
     * If there's a pending difficulty, it'll send that first.
     * @param {array} jobParams - The parameters for the mining.notify method, typically [jobId, prevHash, coinb1, coinb2, merkleBranch, version, bits, target, timestamp, cleanJobs]
     * @return {undefined}
     */
this.sendMiningJob = function(jobParams){
    var lastActivityAgo = Date.now() - _this.lastActivity;
    if (lastActivityAgo > options.connectionTimeout * 1000){
        _this.emit('socketTimeout', 'last submitted a share was ' + (lastActivityAgo / 1000 | 0) + ' seconds ago');
        _this.socket.destroy();
        return;
    }
    
    if (pendingDifficulty !== null){
        var result = _this.sendDifficulty(pendingDifficulty);
        pendingDifficulty = null;
        if (result) {
            _this.emit('difficultyChanged', _this.difficulty);
        }
    }

    // NEW: Modify job parameters for AsicBoost clients
    var finalJobParams = jobParams;
    
    if (_this.asicboost && _this.versionMask && jobParams.length >= 7) {
        // Clone the job parameters to avoid modifying the original
        finalJobParams = jobParams.slice();
        
        // The version is typically at index 5 in mining.notify parameters
        // Standard format: [jobId, prevHash, coinb1, coinb2, merkleBranch, version, bits, ntime, cleanJobs]
        var originalVersion = parseInt(finalJobParams[5], 16);
        
        // For AsicBoost clients, we need to ensure the version allows for rolling
        // The pool should have already prepared a suitable base version
        // We don't modify it here, but we could log it for debugging
        
        //console.log('[Stratum] Sending AsicBoost job to ' + (_this.workerName || 'unknown') + 
        //           ' - base version: 0x' + finalJobParams[5] + 
        //           ', mask: 0x' + _this.versionMask.toString(16));
    }
    
    sendJson({
        id    : null,
        method: "mining.notify",
        params: finalJobParams
    });
};

    /**
     * Updates the version mask for this client (BIP 310).
     * Sends a mining.set_version_mask notification to the client.
     * @param {number} newMask - The new version mask to use
     * @return {boolean} - True if client supports version rolling
     */
    this.setVersionMask = function(newMask) {
        if (!_this.asicboost) {
            return false;
        }
        
        _this.versionMask = newMask;
        sendJson({
            id: null,
            method: "mining.set_version_mask",
            params: [newMask.toString(16)]
        });
        return true;
    };

    /**
     * Manually authorizes the client with the given username and password.
     * This is useful in tests where you want to connect a client to the pool
     * programatically.
     * @param {string} username - The username to authorize with
     * @param {string} password - The password to authorize with
     */
    this.manuallyAuthClient = function (username, password) {
        handleAuthorize({id: 1, params: [username, password]}, false /*do not reply to miner*/);
    };

    /**
     * Copy the extraNonce1, previousDifficulty and difficulty from another StratumClient instance.
     * @param {StratumClient} otherClient - The other StratumClient instance to copy from.
     */
    this.manuallySetValues = function (otherClient) {
        _this.extraNonce1        = otherClient.extraNonce1;
        _this.previousDifficulty = otherClient.previousDifficulty;
        _this.difficulty         = otherClient.difficulty;
    };
};
StratumClient.prototype.__proto__ = events.EventEmitter.prototype;




/**
 * The Stratum protocol server implementation.
 * Manages multiple ports, client connections, and mining job broadcasts.
 * 
 * @class StratumServer
 * @extends {EventEmitter}
 * @param {Object} options - Server configuration
 * @param {Object} options.ports - Port configurations (port number -> config)
 * @param {number} options.connectionTimeout - Client connection timeout (ms)
 * @param {number} options.jobRebroadcastTimeout - Job rebroadcast timeout (seconds)
 * @param {Object} [options.banning] - IP banning configuration
 * @param {boolean} options.banning.enabled - Whether banning is enabled
 * @param {number} options.banning.time - Ban duration in seconds
 * @param {number} options.banning.purgeInterval - Interval to purge old bans
 * @param {boolean} [options.tcpProxyProtocol] - Whether to use HAProxy PROXY protocol
 * @param {Function} authorizeFn - Function to authorize workers
 * 
 * @fires StratumServer#client.connected - When a new miner connects
 * @fires StratumServer#client.disconnected - When a miner disconnects
 * @fires StratumServer#started - When the server is up and running
 * @fires StratumServer#broadcastTimeout - When job broadcast timeout occurs
 * @fires StratumServer#bootedBannedWorker - When a banned worker is kicked
 */
 var StratumServer = exports.Server = function StratumServer(options, authorizeFn){

    //private members
    
    // Add miner state tracking at the top of StratumServer constructor
    var minerStates = {}; // Track miner state by worker+userAgent combination

    // Helper functions for miner state management
    function getMinerKey(workerName, userAgent) {
        // Use worker name + user agent to uniquely identify miners
        return (workerName || 'unknown') + '::' + (userAgent || 'unknown');
    }

    function saveMinerState(workerName, userAgent, client) {
        var key = getMinerKey(workerName, userAgent);
        minerStates[key] = {
            asicboost: client.asicboost,
            versionMask: client.versionMask,
            versionRolling: client.versionRolling,
            negotiatedExtensions: client.negotiatedExtensions,
            difficulty: client.difficulty,
            lastActivity: Date.now(),
            workerName: workerName,
            userAgent: userAgent
        };
        //console.log('[MinerState] Saved state for miner:', key);
    }

    function restoreMinerState(workerName, userAgent, client) {
        var key = getMinerKey(workerName, userAgent);
        var savedState = minerStates[key];
        
        if (savedState && (Date.now() - savedState.lastActivity < 300000)) { // 5 minutes
            client.asicboost = savedState.asicboost;
            client.versionMask = savedState.versionMask;
            client.versionRolling = savedState.versionRolling;
            client.negotiatedExtensions = savedState.negotiatedExtensions;
            client.difficulty = savedState.difficulty;
            
            //console.log('[MinerState] Restored state for miner:', key, 
            //           'AsicBoost:', client.asicboost, 
             //          'Mask:', client.versionMask ? '0x' + client.versionMask.toString(16) : 'none');
            return true;
        }
        return false;
    }

    // Debug log the version mask configuration
    var poolVersionMask;
    if (options.coin && options.coin.versionMask) {
        poolVersionMask = parseInt(options.coin.versionMask, 16);
        console.log('[Stratum] Server configured with versionMask: 0x' + poolVersionMask.toString(16));
    } else {
        poolVersionMask = 0x3fffe000; // Default AsicBoost mask
        console.log('[Stratum] No versionMask in options, using default 0x' + poolVersionMask.toString(16));
    }

    var bannedMS = options.banning ? options.banning.time * 1000 : null;

    var _this = this;
    var stratumClients = {};
    var subscriptionCounter = SubscriptionCounter();
    var rebroadcastTimeout;
    var bannedIPs = {};

    // AsicBoost statistics
    var asicboostStats = {
        totalClients: 0,
        asicboostClients: 0,
        traditionalClients: 0
    };

    /**
     * Check if the client is banned and act accordingly.
     * If banned, it will be disconnected and receive a 'kickedBannedIP' event.
     * If the ban has expired, the client will receive a 'forgaveBannedIP' event.
     * @param {StratumClient} client - The stratum client to check.
     */
    /**
     * Check if the client is banned and act accordingly.
     */
    function checkBan(client){
        if (options.banning && options.banning.enabled && client.remoteAddress in bannedIPs){
            var bannedTime = bannedIPs[client.remoteAddress];
            var bannedTimeAgo = Date.now() - bannedTime;
            var timeLeft = bannedMS - bannedTimeAgo;
            if (timeLeft > 0){
                client.socket.destroy();
                client.emit('kickedBannedIP', timeLeft / 1000 | 0);
            }
            else {
                delete bannedIPs[client.remoteAddress];
                client.emit('forgaveBannedIP');
            }
        }
    }

	this.getLabel = function() {
		return (_this.workerName || 'unknown') + ' [' + _this.remoteAddress + ']';
	};

    /**
     * Handle a new incoming client connection.
     * This method is called for every new client and returns the subscriptionId for the client.
     * @param {net.Socket} socket - The new client socket.
     * @returns {String} The subscriptionId for the client.
     */
    /**
     * Handle a new incoming client connection.
     */
    this.handleNewClient = function (socket){
        socket.setKeepAlive(true);
        var subscriptionId = subscriptionCounter.next();
        var client = new StratumClient({
            subscriptionId: subscriptionId,
            authorizeFn: authorizeFn,
            socket: socket,
            banning: options.banning,
            connectionTimeout: options.connectionTimeout,
            tcpProxyProtocol: options.tcpProxyProtocol,
            coin: options.coin,
            defaultVarDiff: options.defaultVarDiff
        });

        stratumClients[subscriptionId] = client;
        asicboostStats.totalClients++;
        
        // Enhanced connection logging
        //console.log('[WhatsMiner Debug] New connection, SubscriptionID:', subscriptionId);
        
        // Listen for user agent capture
        client.on('subscriptionReceived', function(userAgent) {
            client.userAgent = userAgent;
            //console.log('[MinerState] User agent captured:', userAgent);
            
            // Try to restore state if we have both worker name and user agent
            if (client.workerName && userAgent) {
                restoreMinerState(client.workerName, userAgent, client);
            }
        });
        
        // Listen for AsicBoost capability detection
        client.on('asicboostEnabled', function(capabilities) {
            asicboostStats.asicboostClients++;
            //console.log('[Stratum] AsicBoost enabled for client ' + client.remoteAddress + 
            //           ' with mask: 0x' + capabilities.versionMask.toString(16));
            _this.emit('client.asicboostEnabled', client, capabilities);
        });
        
        client.on('asicboostDisabled', function() {
            asicboostStats.traditionalClients++;
            //console.log('[Stratum] Traditional mining for client ' + client.remoteAddress);
        });

        // Listen for miner authorization
        client.on('minerAuthorized', function(workerName) {
            console.log('[MinerState] Miner authorized:', workerName, 'UserAgent:', client.userAgent);
            
            // Try to restore state now that we have worker name
            if (client.userAgent) {
                restoreMinerState(workerName, client.userAgent, client);
            }
            
            // Save current state when miner gets authorized
            if (client.userAgent) {
                saveMinerState(workerName, client.userAgent, client);
            }
        });

        _this.emit('client.connected', client);
        
        client.on('socketDisconnect', function() {
            // Update statistics when client disconnects  
            asicboostStats.totalClients--;
            if (client.asicboost) {
                asicboostStats.asicboostClients--;
            } else {
                asicboostStats.traditionalClients--;
            }
            
            // Save state before disconnect for potential reconnection
            if (client.workerName && client.userAgent) {
                saveMinerState(client.workerName, client.userAgent, client);
            }
            
            _this.removeStratumClientBySubId(subscriptionId);
            _this.emit('client.disconnected', client);
        }).on('checkBan', function(){
            checkBan(client);
        }).on('triggerBan', function(){
            _this.addBannedIP(client.remoteAddress);
        });
        
        return subscriptionId;
    };
    /**
     * Broadcasts a new mining job to all connected clients.
     * Enhanced to handle both AsicBoost and traditional clients appropriately.
     * @param {Object} jobParams - The parameters of the new mining job.
     * @fires StratumServer#broadcastTimeout
     * @see {@link StratumClient#sendMiningJob}
     */
    this.broadcastMiningJobs = function(jobParams){
        var asicboostCount = 0;
        var traditionalCount = 0;
        
        for (var clientId in stratumClients) {
            var client = stratumClients[clientId];
            
            // Send job to client (client will handle AsicBoost-specific modifications)
            client.sendMiningJob(jobParams);
            
            // Count client types for logging
            if (client.asicboost) {
                asicboostCount++;
            } else {
                traditionalCount++;
            }
        }
        
        // Enhanced logging
        if (asicboostCount > 0 || traditionalCount > 0) {
            console.log('[Stratum] Broadcast job to ' + 
                       asicboostCount + ' AsicBoost clients, ' + 
                       traditionalCount + ' traditional clients');
        }
        
        /* Some miners will consider the pool dead if it doesn't receive a job for around a minute.
           So every time we broadcast jobs, set a timeout to rebroadcast in X seconds unless cleared. */
        clearTimeout(rebroadcastTimeout);
        rebroadcastTimeout = setTimeout(function(){
            _this.emit('broadcastTimeout');
        }, (options.jobRebroadcastTimeout || 55) * 1000);
    };

    /**
     * Get AsicBoost statistics for monitoring
     * @returns {Object} Statistics about AsicBoost usage
     */
    this.getAsicBoostStats = function() {
        return {
            totalClients: asicboostStats.totalClients,
            asicboostClients: asicboostStats.asicboostClients,
            traditionalClients: asicboostStats.traditionalClients,
            asicboostPercentage: asicboostStats.totalClients > 0 ? 
                Math.round((asicboostStats.asicboostClients / asicboostStats.totalClients) * 100) : 0,
            poolVersionMask: '0x' + poolVersionMask.toString(16)
        };
    };

    /**
     * Get detailed client information including AsicBoost capabilities
     * @returns {Array} Array of client information objects
     */
    this.getClientDetails = function() {
        var clients = [];
        for (var clientId in stratumClients) {
            var client = stratumClients[clientId];
            clients.push({
                subscriptionId: clientId,
                remoteAddress: client.remoteAddress,
                workerName: client.workerName || 'unknown',
                asicboost: client.asicboost,
                versionMask: client.versionMask ? '0x' + client.versionMask.toString(16) : null,
                difficulty: client.difficulty,
                lastActivity: client.lastActivity,
                shares: client.shares
            });
        }
        return clients;
    };

    (function init(){

        //Interval to look through bannedIPs for old bans and remove them in order to prevent a memory leak
        if (options.banning && options.banning.enabled){
            setInterval(function(){
                for (ip in bannedIPs){
                    var banTime = bannedIPs[ip];
                    if (Date.now() - banTime > options.banning.time)
                        delete bannedIPs[ip];
                }
            }, 1000 * options.banning.purgeInterval);
        }

        // Periodic AsicBoost statistics logging
        setInterval(function() {
            var stats = _this.getAsicBoostStats();
            if (stats.totalClients > 0) {
                console.log('[Stratum] AsicBoost Stats - Total: ' + stats.totalClients + 
                           ', AsicBoost: ' + stats.asicboostClients + 
                           ' (' + stats.asicboostPercentage + '%), Traditional: ' + 
                           stats.traditionalClients);
            }
        }, 300000); // Log every 5 minutes

        var serversStarted = 0;
        Object.keys(options.ports).forEach(function(port){
            net.createServer({allowHalfOpen: false}, function(socket) {
                _this.handleNewClient(socket);
            }).listen(parseInt(port), function() {
                serversStarted++;
                if (serversStarted == Object.keys(options.ports).length) {
                    console.log('[Stratum] All servers started with AsicBoost support enabled');
                    _this.emit('started');
                }
            });
        });
    })();

    //public members

    /**
     * Bans a given IP address.
     * @param {String} ipAddress - The IP address of the client to ban.
     * @fires StratumServer#bootedBannedWorker
     */
    this.addBannedIP = function(ipAddress){
        bannedIPs[ipAddress] = Date.now();
    };

    /**
     * Returns an object with all currently connected clients, where the keys are the subscriptionIds
     * and the values are StratumClient instances.
     * @return {Object} The object with all currently connected clients.
     */
    this.getStratumClients = function () {
        return stratumClients;
    };

    /**
     * Removes a client from the list of connected clients by its subscriptionId.
     * @param {String} subscriptionId - The subscriptionId of the client to remove.
     */
    this.removeStratumClientBySubId = function (subscriptionId) {
        delete stratumClients[subscriptionId];
    };

    /**
     * Manually adds a stratum client to the pool's list of connected clients. Useful for testing.
     * @param {Object} clientObj - An object containing the following properties:
     *                              - `socket`: The socket object of the client.
     *                              - `workerName`: The worker name of the client.
     *                              - `workerPass`: The worker password of the client.
     */
    this.manuallyAddStratumClient = function(clientObj) {
        var subId = _this.handleNewClient(clientObj.socket);
        if (subId != null) { // not banned!
            stratumClients[subId].manuallyAuthClient(clientObj.workerName, clientObj.workerPass);
            stratumClients[subId].manuallySetValues(clientObj);
        }
    };

};
StratumServer.prototype.__proto__ = events.EventEmitter.prototype;
