'use strict';

var Buffer = require('buffer').Buffer;

var RequestOptions = require('./peers-collection.js').RequestOptions;
var indirectEval = require('./_lib-indirect-eval.js');
var V2Frames = require('./v2-frames.js');

var EMPTY_BUFFER = new Buffer(0);

module.exports = buildFastClient;

/*

function TChannelFastClient(ping, set, get) {
    this.pingEndpoint = ping;
    this.setEndpoint = set;
    this.getEndpoint = get;
}

TChannelFastClient.prototype.sendPing =
function sendPing(options, onResponse) {
    this.pingEndpoint.send(options, onResponse);
};

TChannelFastClient.prototype.sendGet =
function sendGet(options, onResponse) {
    this.getEndpoint.send(options, onResponse);
};

TChannelFastClient.prototype.sendSet =
function sendSet(options, onResponse) {
    this.setEndpoint.send(options, onResponse);
};

*/

function buildFastClient(channel, serviceName, endpoints) {
    var i;
    var endpoint;
    var fieldName;
    var endpointNames = Object.keys(endpoints);

    var endpointSenders = [];
    for (i = 0; i < endpointNames.length; i++) {
        endpoint = endpointNames[i];
        endpointSenders.push(new EndpointSender(
            channel, serviceName, endpoint, endpoints[endpoint]
        ));
    }

    var constrSrc = '';
    constrSrc += '(function TChannelFastClient(endpoints) {\n';
    for (i = 0; i < endpointNames.length; i++) {
        fieldName = endpointNames[i] + 'Endpoint';

        constrSrc += '    this.' + fieldName + ' = endpoints[' + i + '];\n';
    }
    constrSrc += '})\n';

    var ConstrFn = indirectEval(constrSrc);

    for (i = 0; i < endpointNames.length; i++) {
        endpoint = endpointNames[i];
        var methodName = 'send' + endpoint[0].toUpperCase() + endpoint.slice(1);
        fieldName = endpoint + 'Endpoint';

        var methodSrc = '';
        methodSrc += '(function ' + methodName + '(options, onResponse) {\n';
        methodSrc += '    this.' + fieldName + '.send(options, onResponse);\n';
        methodSrc += '})\n';

        ConstrFn.prototype[methodName] = indirectEval(methodSrc);
    }

    return new ConstrFn(endpointSenders);
}

function EndpointSender(channel, serviceName, endpoint, options) {
    this.channel = channel;
    this.serviceName = serviceName;
    this.endpoint = endpoint;
    this.options = options;

    var headers = this.options.headers;
    if (!headers) {
        headers = [];
    } else if (!Array.isArray(headers)) {
        headers = toFlatArray(headers);
    }
    var headersLen = V2Frames.headersSize(headers);
    this.headersbuf = new Buffer(headersLen);
    V2Frames.writeHeaders(this.headersbuf, 0, headers);

    this.ttl = this.options.ttl || 100;
    this.arg1buf = new Buffer(this.endpoint, 'utf8');
}

EndpointSender.prototype.send = function send(options, onResponse) {
    var self = this;

    var arg2 = options.arg2 || EMPTY_BUFFER;
    var arg3 = options.arg3 || EMPTY_BUFFER;

    var reqOpts = new RequestOptions(
        self.serviceName,
        options.host,
        self.ttl,
        null,
        self.headersbuf,
        null,
        self.arg1buf,
        typeof arg2 === 'string' ? arg2 : null,
        Buffer.isBuffer(arg2) ? arg2 : null,
        typeof arg3 === 'string' ? arg3 : null,
        Buffer.isBuffer(arg3) ? arg3 : null
    );
    self.channel.peers._send(reqOpts, onResponse);
};

function toFlatArray(object) {
    var flatList = [];

    /*eslint guard-for-in: 0*/
    for (var key in object) {
        flatList.push(key);
        flatList.push(object[key]);
    }

    return flatList;
}
