'use strict';

var PeersCollection = require('./peers-collection.js');

module.exports = RelayHandler;

function RelayHandler(channel, destinations) {
    if (!(this instanceof RelayHandler)) {
        return new RelayHandler(channel);
    }

    this.channel = channel;
    this.peers = new PeersCollection(channel);

    for (var i = 0; i < destinations.length; i++) {
        this.peers.createConnection(destinations[i]);
    }
}

RelayHandler.prototype.handleFrame =
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

RelayHandler.prototype.handleInitRequest =
function handleInitRequest(frame) {
    var conn = frame.sourceConnection;

    conn.handleInitRequest(frame);
    // LazyFrame.free(frame);
};

RelayHandler.prototype.handleInitResponse =
function handleInitResponse(frame) {
    var conn = frame.sourceConnection;

    conn.handleInitResponse(frame);
    // LazyFrame.free(frame);
};

RelayHandler.prototype.handleCallRequest =
function handleCallRequest(frame) {
    var self = this;

    var inId = frame.readId();
    var destConn = self.peers.roundRobinConn();
    var outId = destConn.allocateId();

    frame.writeId(outId);

    var info = new RelayInfo(inId, frame.sourceConnection);
    destConn.addPendingOutReq(outId, info, 1000);

    var buf = frame.frameBuffer.slice(frame.offset, frame.length)
    destConn.writeFrame(buf);
};

RelayHandler.prototype.handleCallResponse =
function handleCallResponse(frame) {
    // VERY IMPORTANT LOL
    frame.markAsCallResponse();

    var frameId = frame.readId();

    var op = frame.sourceConnection.popPendingOutReq(frameId);
    if (!op) {
        console.error('Got unknown call response');
        return;
    }

    frame.writeId(op.data.inId);

    var buf = frame.frameBuffer.slice(frame.offset, frame.length);
    op.data.connection.writeFrame(buf);
};

function RelayInfo(inId, connection) {
    this.inId = inId;
    this.connection = connection;
}

RelayHandler.prototype.handleUnknownFrame =
function handleUnknownFrame(frame) {
    /* eslint no-console: 0*/
    console.error('unknown frame', frame);
    console.error('buf as string', frame.frameBuffer.toString());
};
