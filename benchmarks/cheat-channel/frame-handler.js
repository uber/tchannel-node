'use strict';

/*eslint no-console: 0*/
var console = require('console');
var Buffer = require('buffer').Buffer;

// var LazyFrame = require('./lazy-frame.js');
var V2Frames = require('./v2-frames.js');
var OutResponse = require('./out-response.js');

module.exports = FrameHandler;

function FrameHandler() {
    if (!(this instanceof FrameHandler)) {
        return new FrameHandler();
    }

    this.services = Object.create(null);
}

FrameHandler.prototype.register =
function register(serviceName, endpoint, fn) {
    var self = this;

    if (!self.services[serviceName]) {
        self.services[serviceName] = Object.create(null);
    }

    self.services[serviceName][endpoint] =
        new EndpointDefinition(fn, null, null);
};

FrameHandler.prototype.registerRaw =
function registerRaw(serviceName, endpoint, fn) {
    var self = this;

    if (!self.services[serviceName]) {
        self.services[serviceName] = Object.create(null);
    }

    var headers = ['as', 'raw'];
    var byteLength = V2Frames.partialCallResponseSize(headers);
    var cacheBuf = new Buffer(byteLength);
    var csumstart = V2Frames.partialCallResponseWriteHead(
        cacheBuf, 0, headers
    );

    self.services[serviceName][endpoint] =
        new EndpointDefinition(fn, cacheBuf, csumstart);
};

function EndpointDefinition(fn, cacheBuf, csumstart) {
    this.fn = fn;
    this.cacheBuf = cacheBuf;
    this.csumstart = csumstart;
}

FrameHandler.prototype.handleFrame =
function handleFrame(frame) {
    var self = this;

    var frameType = frame.readFrameType();

    switch (frameType) {
        case 0x01:
            return self.handleInitRequest(frame);
        case 0x02:
            return self.handleInitResponse(frame);
        case 0x03:
            return self.handleCallRequest(frame);
        case 0x04:
            return self.handleCallResponse(frame);
        default:
            return self.handleUnknownFrame(frame);
    }
};

FrameHandler.prototype.handleInitRequest =
function handleInitRequest(frame) {
    var conn = frame.sourceConnection;

    conn.handleInitRequest(frame);
    // LazyFrame.free(frame);
};

FrameHandler.prototype.handleInitResponse =
function handleInitResponse(frame) {
    var conn = frame.sourceConnection;

    conn.handleInitResponse(frame);
    // LazyFrame.free(frame);
};

FrameHandler.prototype.handleCallRequest =
function handleCallRequest(frame) {
    var self = this;

    var reqFrameId = frame.readId();
    var reqServiceName = frame.readReqServiceName();
    var reqArg1 = frame.readArg1str();

    var endpoints = self.services[reqServiceName];
    if (!endpoints) {
        console.error('Could not find serviceName: %s', reqServiceName);
        return;
    }

    var defn = endpoints[reqArg1];
    if (!defn) {
        console.error('Could not find arg1: %s', reqArg1);
        return;
    }

    var conn = frame.sourceConnection;
    var resp = new OutResponse(
        reqFrameId, conn, defn.cacheBuf, defn.csumstart
    );
    defn.fn(frame, resp);
    // LazyFrame.free(frame);
};

FrameHandler.prototype.handleCallResponse =
function handleCallResponse(frame) {
    // VERY IMPORTANT LOL
    frame.markAsCallResponse();

    var conn = frame.sourceConnection;
    var resFrameId = frame.readId();

    var outOp = conn.popPendingOutReq(resFrameId);
    if (!outOp) {
        console.error('got call response for unknown id: %d', resFrameId);
        return;
    }

    var onResponse = outOp.onResponse;
    onResponse(null, frame);
    // LazyFrame.free(frame);
};

FrameHandler.prototype.handleUnknownFrame =
function handleUnknownFrame(frame) {
    /* eslint no-console: 0*/
    console.error('unknown frame', frame);
    console.error('buf as string', frame.frameBuffer.toString());
};
