// Copyright (c) 2016 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

var TypedError = require('error/typed');
var WrappedError = require('error/wrapped');
var bufrwErrors = require('bufrw/errors');

var Errors = module.exports;

// All exported errors must be in sorted order

Errors.Arg1Fragmented = TypedError({
    type: 'tchannel.arg1-fragmented',
    message: 'arg1 must not be fragmented'
});

Errors.Arg1OverLengthLimit = TypedError({
    type: 'tchannel.arg1-over-length-limit',
    message: 'arg1 length {length} is larger than the limit {limit}',
    length: null,
    limit: null
});

Errors.ArgChunkGapError = TypedError({
    type: 'tchannel.arg-chunk.gap',
    message: 'arg chunk gap, current: {current} got: {got}',
    current: null,
    got: null
});

Errors.ArgChunkOutOfOrderError = TypedError({
    type: 'tchannel.arg-chunk.out-of-order',
    message: 'out of order arg chunk, current: {current} got: {got}',
    current: null,
    got: null
});

Errors.ArgStreamExceededFramePartsError = TypedError({
    type: 'tchannel.argstream.exceeded-frame-parts',
    message: 'frame parts exceeded stream arity'
});

Errors.ArgStreamFinishedError = TypedError({
    type: 'tchannel.argstream.finished',
    message: 'arg stream already finished'
});

Errors.ArgStreamUnimplementedError = TypedError({
    type: 'tchannel.argstream.unimplemented',
    message: 'un-streamed argument defragmentation is not implemented'
});

Errors.ArgStreamUnknownFrameHandlingStateError = TypedError({
    type: 'tchannel.argstream.unknown-frame-handling-state',
    message: 'unknown frame handling state'
});

Errors.BadCallRequestFrameError = TypedError({
    type: 'tchannel.bad-call-request',
    message: 'Bad call request: {reason}',
    reason: null
});

Errors.CallReqBeforeInitReqError = TypedError({
    type: 'tchannel.init.call-request-before-init-request',
    message: 'call request before init request'
});

Errors.CallReqContBeforeInitReqError = TypedError({
    type: 'tchannel.init.call-request-cont-before-init-request',
    message: 'call request cont before init request'
});

Errors.CallResBeforeInitResError = TypedError({
    type: 'tchannel.init.call-response-before-init-response',
    message: 'call response before init response'
});

Errors.CallResContBeforeInitResError = TypedError({
    type: 'tchannel.init.call-response-cont-before-init-response',
    message: 'call response cont before init response'
});

Errors.ChecksumError = TypedError({
    type: 'tchannel.checksum',
    message: 'invalid checksum (type {checksumType}) expected: {expectedValue} actual: {actualValue}',
    checksumType: null,
    expectedValue: null,
    actualValue: null
});

Errors.ChecksumTypeChanged = TypedError({
    type: 'tchannel.call.checksum-type-changed',
    message: 'checksum type changed mid-stream',
    initialChecksumType: null,
    newChecksumType: null
});

Errors.ConnectionStaleTimeoutError = TypedError({
    type: 'tchannel.connection-stale.timeout',
    message: 'Connection got two timeouts in a row.\n' +
        'Connection has been marked as stale and will be timed out',
    period: null,
    elapsed: null,
    lastTimeoutTime: null
});

Errors.ConnectionTimeoutError = TypedError({
    type: 'tchannel.connection.timeout',
    message: 'connection timed out after {elapsed}ms ' +
        '(limit was {timeout}ms)',
    id: null,
    start: null,
    elapsed: null,
    timeout: null
});

Errors.CorruptWriteLazyFrame = TypedError({
    type: 'tchannel.lazy-frame.write-corrupt',
    message: 'could not serialize lazy frame due to {context}',
    context: null
});

Errors.DuplicateHeaderKeyError = TypedError({
    type: 'tchannel.duplicate-header-key',
    message: 'duplicate header key {key}',
    offset: null,
    endOffset: null,
    key: null,
    value: null,
    priorValue: null
});

Errors.DuplicateInitRequestError = TypedError({
    type: 'tchannel.init.duplicate-init-request',
    message: 'tchannel: duplicate init request'
});

Errors.DuplicateInitResponseError = TypedError({
    type: 'tchannel.init.duplicate-init-response',
    message: 'tchannel: duplicate init response'
});

Errors.EphemeralInitResponse = TypedError({
    type: 'tchannel.init.ephemeral-init-response',
    message: 'tchannel: got invalid 0.0.0.0:0 as hostPort in Init Response',
    hostPort: null,
    socketRemoteAddr: null,
    processName: null
});

Errors.HTTPReqArg2fromBufferError = WrappedError({
    type: 'tchannel.http-handler.from-buffer-arg2.req-failed',
    message: 'Could not read from buffer when sending request.',
    isSerializationError: true,
    arg2: null
});

Errors.HTTPReqArg2toBufferError = WrappedError({
    type: 'tchannel.http-handler.to-buffer-arg2.req-failed',
    message: 'Could not write to buffer when sending request.',
    isSerializationError: true,
    head: null
});

Errors.HTTPResArg2fromBufferError = WrappedError({
    type: 'tchannel.http-handler.from-buffer-arg2.res-failed',
    message: 'Could not read from buffer when sending response.',
    isSerializationError: true,
    arg2: null
});

Errors.HTTPResArg2toBufferError = WrappedError({
    type: 'tchannel.http-handler.to-buffer-arg2.res-failed',
    message: 'Could not write to buffer when sending response.',
    isSerializationError: true,
    head: null
});

Errors.InAsHeaderRequired = TypedError({
    type: 'tchannel.handler.incoming-req-as-header-required',
    message: 'Expected incoming call {frame} to have "as" header set.',
    frame: null
});

Errors.InCnHeaderRequired = TypedError({
    type: 'tchannel.handler.incoming-req-cn-header-required',
    message: 'Expected incoming call request to have "cn" header set.'
});

Errors.InvalidArgumentError = TypedError({
    type: 'tchannel.invalid-argument',
    message: 'invalid argument, expected array or null',
    argType: null,
    argConstructor: null
});

Errors.InvalidErrorCodeError = TypedError({
    type: 'tchannel.invalid-error-code',
    message: 'invalid tchannel error code {errorCode}',
    errorCode: null,
    originalId: null
});

Errors.InvalidFrameTypeError = TypedError({
    type: 'tchannel.invalid-frame-type',
    message: 'invalid frame type {typeNumber}',
    typeNumber: null
});

Errors.InvalidHandlerError = TypedError({
    type: 'tchannel.invalid-handler',
    message: 'invalid handler function'
});

Errors.InvalidHandlerForRegister = TypedError({
    type: 'tchannel.invalid-handler.for-registration',
    message: 'Found unexpected handler when calling `.register()`.\n' +
        'You cannot set a custom handler when using `.register()`.\n' +
        '`.register()` is deprecated; use a proper handler.',
    handlerType: null,
    handler: null
});

Errors.InvalidHeaderTypeError = TypedError({
    type: 'tchannel.invalid-header-type',
    message: 'invalid header type for header {name}; ' +
        'expected string, got {headerType}',
    headerType: null,
    name: null
});

Errors.InvalidInitHostPortError = TypedError({
    type: 'tchannel.invalid-init-host-port',
    message: 'invalid host:port string in init header',
    hostPort: null
});

Errors.InvalidJSONBody = TypedError({
    type: 'tchannel-handler.json.invalid-body',
    message: 'Invalid error body, expected a typed-error',
    isSerializationError: true,
    head: null,
    body: null
});

Errors.InvalidTTL = TypedError({
    type: 'tchannel.protocol.invalid-ttl',
    message: 'Got an invalid ttl. Expected positive ttl but got {ttl}',
    ttl: null,
    isParseError: null
});

Errors.JSONBodyParserError = WrappedError({
    type: 'tchannel-json-handler.parse-error.body-failed',
    message: 'Could not parse body (arg3) argument.\n' +
        'Expected JSON encoded arg3 for endpoint {endpoint}.\n' +
        'Got {bodyStr} instead of JSON.',
    isSerializationError: true,
    endpoint: null,
    direction: null,
    bodyStr: null
});

Errors.JSONBodyStringifyError = WrappedError({
    type: 'tchannel-json-handler.stringify-error.body-failed',
    message: 'Could not stringify body (res2) argument.\n' +
        'Expected JSON serializable res2 for endpoint {endpoint}.',
    isSerializationError: true,
    endpoint: null,
    body: null,
    direction: null
});

Errors.JSONHeadParserError = WrappedError({
    type: 'tchannel-json-handler.parse-error.head-failed',
    message: 'Could not parse head (arg2) argument.\n' +
        'Expected JSON encoded arg2 for endpoint {endpoint}.\n' +
        'Got {headStr} instead of JSON.',
    isSerializationError: true,
    endpoint: null,
    direction: null,
    headStr: null
});

Errors.JSONHeadStringifyError = WrappedError({
    type: 'tchannel-json-handler.stringify-error.head-failed',
    message: 'Could not stringify head (res1) argument.\n' +
        'Expected JSON serializable res1 for endpoint {endpoint}.',
    isSerializationError: true,
    endpoint: null,
    head: null,
    direction: null
});

Errors.LocalSocketCloseError = TypedError({
    type: 'tchannel.socket-local-closed',
    message: 'tchannel: Connection was manually closed.'
});

Errors.MaxPendingError = TypedError({
    type: 'tchannel.max-pending',
    message: 'maximum pending requests exceeded (limit was {pending})',
    pending: null
});

Errors.MaxPendingForServiceError = TypedError({
    type: 'tchannel.max-pending-for-service',
    message: 'maximum pending requests exceeded for service (limit was {pending} for service {serviceName})',
    pending: null,
    serviceName: null
});

Errors.MissingInitHeaderError = TypedError({
    type: 'tchannel.missing-init-header',
    message: 'missing init frame header {field}',
    field: null
});

Errors.NoPeerAvailable = TypedError({
    type: 'tchannel.no-peer-available',
    message: 'no peer available for request'
});

Errors.NoServiceHandlerError = TypedError({
    type: 'tchannel.no-service-handler',
    message: 'unknown service {serviceName}',
    serviceName: null
});

Errors.NullKeyError = TypedError({
    type: 'tchannel.null-key',
    message: 'null key',
    offset: null,
    endOffset: null
});

Errors.OrphanCallRequestCont = TypedError({
    type: 'tchannel.call-request.orphan-cont',
    message: 'orphaned call request cont',
    frameId: null
});

Errors.OrphanCallResponseCont = TypedError({
    type: 'tchannel.call-response.orphan-cont',
    message: 'orphaned call response cont',
    frameId: null
});

Errors.OutAsHeaderRequired = TypedError({
    type: 'tchannel.handler.outgoing-req-as-header-required',
    message: 'Expected outgoing call request to have "as" header set.'
});

Errors.OutCnHeaderRequired = TypedError({
    type: 'tchannel.handler.outgoing-req-cn-header-required',
    message: 'Expected outgoing call request to have "cn" header set.'
});

Errors.ParentRequired = TypedError({
    type: 'tchannel.tracer.parent-required',
    message: 'parent not specified for outgoing call req.\n' +
        'Expected either a parent or hasNoParent.\n' +
        'For the call to {serviceName}.\n',
    parentSpan: null,
    hasNoParent: null,
    serviceName: null
});

Errors.PeerDrainTimedOutError = TypedError({
    type: 'tchannel.drain.peer.timed-out',
    message: 'peer drain timed out',
    direction: null,
    elapsed: null,
    timeout: null
});

Errors.ReconstructedError = TypedError({
    type: 'tchannel.hydrated-error.default-type',
    message: 'TChannel json hydrated error;' +
        ' this message should be replaced with an upstream error message'
});

Errors.RequestAlreadyDone = TypedError({
    type: 'tchannel.request-already-done',
    message: 'cannot {attempted}, request already done',
    attempted: null
});

Errors.RequestDrained = TypedError({
    type: 'tchannel.request.drained',
    message: 'refusing to send drained request: {reason}',
    reason: null
});

Errors.RequestFrameState = TypedError({
    type: 'tchannel.request-frame-state',
    message: 'cannot send {attempted} in {state} request state',
    attempted: null,
    state: null
});

Errors.RequestRetryLimitExceeded = TypedError({
    type: 'tchannel.request.retry-limit-exceeded',
    message: 'exceeded retry limit',
    limit: null
});

Errors.RequestTimeoutError = TypedError({
    type: 'tchannel.request.timeout',
    message: 'request timed out after {elapsed}ms ' +
        '(limit was {timeout}ms)',
    id: null,
    start: null,
    elapsed: null,
    timeout: null,
    logical: false
});

Errors.ResponseAlreadyDone = TypedError({
    type: 'tchannel.response-already-done',
    message: 'cannot send {attempted}, response already done ' +
        'in state: {currentState}',
    attempted: null,
    currentState: null
});

Errors.ResponseAlreadyStarted = TypedError({
    type: 'tchannel.response-already-started',
    message: 'response already started (state {state})',
    state: null
});

Errors.ResponseFrameState = TypedError({
    type: 'tchannel.response-frame-state',
    message: 'cannot send {attempted} in {state} response state',
    attempted: null,
    state: null
});

Errors.SendCallReqBeforeIdentifiedError = TypedError({
    type: 'tchannel.init.send-call-request-before-indentified',
    message: 'cannot send call request before the connection is identified'
});

Errors.SendCallReqContBeforeIdentifiedError = TypedError({
    type: 'tchannel.init.send-call-request-cont-before-indentified',
    message: 'cannot send call request cont before the connection is identified'
});

Errors.SendCallResBeforeIdentifiedError = TypedError({
    type: 'tchannel.init.send-call-response-before-indentified',
    message: 'cannot send call response before the connection is identified'
});

Errors.SendCallResContBeforeIdentifiedError = TypedError({
    type: 'tchannel.init.send-call-response-cont-before-indentified',
    message: 'cannot send call response cont before the connection is identified'
});

Errors.SocketClosedError = TypedError({
    type: 'tchannel.socket-closed',
    message: 'socket closed, {reason}',
    reason: null
});

Errors.SocketError = WrappedError({
    type: 'tchannel.socket',
    message: 'tchannel socket error ({code} from {syscall}): {origMessage}',
    hostPort: null,
    direction: null,
    remoteAddr: null
});

Errors.SocketWriteFullError = TypedError({
    type: 'tchannel.socket.write-full',
    message: 'Could not write to socket; socket has {pendingWrites} writes',
    pendingWrites: null
});

Errors.TChannelConnectionCloseError = TypedError({
    type: 'tchannel.connection.close',
    message: 'connection closed'
});

Errors.TChannelConnectionResetError = WrappedError({
    type: 'tchannel.connection.reset',
    message: 'tchannel: {causeMessage}'
});

Errors.TChannelDestroyedError = TypedError({
    type: 'tchannel.destroyed',
    message: 'the channel is destroyed'
});

Errors.TChannelListenError = WrappedError({
    type: 'tchannel.server.listen-failed',
    message: 'tchannel: {origMessage}, {host}:{requestedPort}',
    requestedPort: null,
    host: null
});

Errors.TChannelLocalResetError = WrappedError({
    type: 'tchannel.local.reset',
    message: 'tchannel: {causeMessage}'
});

Errors.TChannelReadProtocolError = WrappedError({
    type: 'tchannel.protocol.read-failed',
    message: 'tchannel read failure: {origMessage}',
    remoteName: null,
    localName: null
});

Errors.TChannelUnhandledFrameTypeError = TypedError({
    type: 'tchannel.unhandled-frame-type',
    message: 'unhandled frame type {typeCode}',
    typeCode: null
});

Errors.TChannelWriteProtocolError = WrappedError({
    type: 'tchannel.protocol.write-failed',
    message: 'tchannel write failure: {origMessage}',
    remoteName: null,
    localName: null
});

Errors.ThriftBodyParserError = WrappedError({
    type: 'tchannel-thrift-handler.parse-error.body-failed',
    message: 'Could not parse body (arg3) argument.\n' +
        'Expected Thrift encoded arg3 for endpoint {endpoint}.\n' +
        'Got {bodyBuf} instead of Thrift.\n' +
        'Parsing error was: {causeMessage}.\n',
    isSerializationError: true,
    endpoint: null,
    direction: null,
    ok: null,
    bodyBuf: null
});

Errors.ThriftBodyStringifyError = WrappedError({
    type: 'tchannel-thrift-handler.stringify-error.body-failed',
    message: 'Could not stringify body (res2) argument.\n' +
        'Expected Thrift serializable res2 for endpoint {endpoint}.',
    isSerializationError: true,
    endpoint: null,
    ok: null,
    body: null,
    direction: null
});

Errors.ThriftHeadParserError = WrappedError({
    type: 'tchannel-thrift-handler.parse-error.head-failed',
    message: 'Could not parse head (arg2) argument.\n' +
        'Expected Thrift encoded arg2 for endpoint {endpoint}.\n' +
        'Got {headBuf} instead of Thrift.\n' +
        'Parsing error was: {causeMessage}.\n',
    isSerializationError: true,
    endpoint: null,
    ok: null,
    direction: null,
    headBuf: null
});

Errors.ThriftHeadStringifyError = WrappedError({
    type: 'tchannel-thrift-handler.stringify-error.head-failed',
    message: 'Could not stringify head (res1) argument.\n' +
        'Expected Thrift serializable res1 for endpoint {endpoint}.',
    isSerializationError: true,
    endpoint: null,
    ok: null,
    head: null,
    direction: null
});

Errors.TooManyHeaders = TypedError({
    type: 'tchannel.protocol.too-many-headers',
    message: 'too many transport headers, got {count}, expected at most {maxHeaderCount}',
    count: null,
    maxHeaderCount: null,
    offset: null,
    endOffset: null
});

Errors.TopLevelRegisterError = TypedError({
    type: 'tchannel.top-level-register',
    message: 'Cannot register endpoints points on top-level channel.\n' +
        'Provide serviceName to constructor, or create a sub-channel.'
});

Errors.TopLevelRequestError = TypedError({
    type: 'tchannel.top-level-request',
    message: 'Cannot make request() on top level tchannel.\n' +
        'Must use a sub channel directly.'
});

Errors.TransportHeaderTooLong = TypedError({
    type: 'tchannel.transport-header-too-long',
    message: 'transport header: {headerName} exceeds {maxLength} bytes',
    maxLength: null,
    headerName: null,
    offset: null,
    endOffset: null
});

Errors.UnexpectedCallFrameAfterDone = TypedError({
    type: 'tchannel.call.frame-unexpected.after-done',
    message: 'got call frame (type {frameType}) in done state',
    frameId: null,
    frameType: null
});

Errors.UnexpectedCallFrameAfterError = TypedError({
    type: 'tchannel.call.frame-unexpected.after-error',
    message: 'got call frame (type {frameType}) in error state',
    frameId: null,
    frameType: null
});

Errors.UnimplementedMethod = TypedError({
    message: 'Unimplemented {className}#{methodName}',
    type: 'tchannel.unimplemented-method',
    className: null,
    methodName: null
});

Errors.UnknownConnectionReset = TypedError({
    type: 'tchannel.connection.unknown-reset',
    message: 'unknown connection reset'
});

// utilities
/*eslint-disable complexity*/
Errors.classify = function classify(err) {
    if (err.isErrorFrame) {
        return err.codeName;
    }

    if (err.type && err.type.indexOf('bufrw.') > -1) {
        return classifyBurwError(err);
    }

    switch (err.type) {
        case 'tchannel.request.retry-limit-exceeded':
            return 'Cancelled';

        case 'tchannel.max-pending':
        case 'tchannel.max-pending-for-service':
        case 'tchannel.no-peer-available':
        case 'tchannel.no-service-handler':
        case 'tchannel.request.drained':
            return 'Declined';

        case 'tchannel.connection-stale.timeout':
        case 'tchannel.connection.timeout':
        case 'tchannel.request.timeout':
            return 'Timeout';

        case 'tchannel-handler.json.invalid-body':
        case 'tchannel-json-handler.parse-error.body-failed':
        case 'tchannel-json-handler.parse-error.head-failed':
        case 'tchannel-thrift-handler.parse-error.body-failed':
        case 'tchannel-thrift-handler.parse-error.head-failed':
        case 'tchannel.arg-chunk.gap':
        case 'tchannel.arg-chunk.out-of-order':
        case 'tchannel.arg1-fragmented':
        case 'tchannel.arg1-over-length-limit':
        case 'tchannel.argstream.exceeded-frame-parts':
        case 'tchannel.bad-call-request':
        case 'tchannel.call.checksum-type-changed':
        case 'tchannel.checksum':
        case 'tchannel.duplicate-header-key':
        case 'tchannel.handler.incoming-req-as-header-required':
        case 'tchannel.handler.incoming-req-cn-header-required':
        case 'tchannel.http-handler.to-buffer-arg2.req-failed':
        case 'tchannel.http-handler.to-buffer-arg2.res-failed':
        case 'tchannel.null-key':
        case 'tchannel.request-already-done':
        case 'tchannel.request-frame-state':
            return 'BadRequest';

        case 'tchannel.argstream.finished':
        case 'tchannel.argstream.unimplemented':

        // TODO: really we'd rather classify as BadRequest. see note in
        // TChannelV2Handler#handleCallRequestCont wrt frame id association
        // support
        case 'tchannel.call-request.orphan-cont':

        // TODO: can BadRequest be used for a response error? Maybe instead we
        // could use UnexpectedError rather than terminate the connection?
        case 'tchannel.call-response.orphan-cont':

        // TODO: classify as BadRequest/UnexpectedError for req/res?
        case 'tchannel.call.frame-unexpected.after-done':
        case 'tchannel.call.frame-unexpected.after-error':

        case 'tchannel.init.call-request-before-init-request':
        case 'tchannel.init.call-request-cont-before-init-request':
        case 'tchannel.init.call-response-before-init-response':
        case 'tchannel.init.call-response-cont-before-init-response':
        case 'tchannel.init.duplicate-init-request':
        case 'tchannel.init.duplicate-init-response':
        case 'tchannel.init.ephemeral-init-response':
        case 'tchannel.init.send-call-request-before-indentified':
        case 'tchannel.init.send-call-request-cont-before-indentified':
        case 'tchannel.init.send-call-response-before-indentified':
        case 'tchannel.init.send-call-response-cont-before-indentified':
        case 'tchannel.invalid-error-code':
        case 'tchannel.invalid-frame-type':
        case 'tchannel.invalid-init-host-port':
        case 'tchannel.missing-init-header':
        case 'tchannel.protocol.invalid-ttl':
        case 'tchannel.protocol.read-failed':
        case 'tchannel.protocol.too-many-headers':
        case 'tchannel.protocol.write-failed':
        case 'tchannel.transport-header-too-long':
        case 'tchannel.unhandled-frame-type':
            return 'ProtocolError';

        case 'tchannel.connection.close':
        case 'tchannel.connection.reset':
        case 'tchannel.destroyed':
        case 'tchannel.local.reset':
        case 'tchannel.socket':
        case 'tchannel.socket-closed':
        case 'tchannel.socket-local-closed':
        case 'tchannel.socket.write-full':
            return 'NetworkError';

        case 'tchannel-json-handler.stringify-error.body-failed':
        case 'tchannel-json-handler.stringify-error.head-failed':
        case 'tchannel-thrift-handler.stringify-error.body-failed':
        case 'tchannel-thrift-handler.stringify-error.head-failed':
        case 'tchannel.argstream.unknown-frame-handling-state':
        case 'tchannel.connection.unknown-reset':
        case 'tchannel.drain.peer.timed-out':
        case 'tchannel.handler.outgoing-req-as-header-required':
        case 'tchannel.handler.outgoing-req-cn-header-required':
        case 'tchannel.http-handler.from-buffer-arg2.req-failed':
        case 'tchannel.http-handler.from-buffer-arg2.res-failed':
        case 'tchannel.hydrated-error.default-type':
        case 'tchannel.invalid-argument':
        case 'tchannel.invalid-handler':
        case 'tchannel.invalid-handler.for-registration':
        case 'tchannel.invalid-header-type':
        case 'tchannel.lazy-frame.write-corrupt':
        case 'tchannel.response-already-done':
        case 'tchannel.response-already-started':
        case 'tchannel.response-frame-state':
        case 'tchannel.server.listen-failed':
        case 'tchannel.top-level-register':
        case 'tchannel.top-level-request':
        case 'tchannel.tracer.parent-required':
        case 'tchannel.unimplemented-method':
            return 'UnexpectedError';

        default:
            return null;
    }
};
/*eslint-enable complexity*/

function classifyBurwError(err) {
    var bufrwClass = bufrwErrors.classify(err);
    if (bufrwClass !== null) {
        switch (bufrwClass) {
            case 'Read':
                return 'NetworkError';
            case 'Write':
                return 'ProtocolError';
            case 'Internal':
            default:
                return 'UnexpectedError';
        }
    }
}

// To determine whether a circuit should break for each response code.
// TODO consider whether to keep a circuit healthy if a downstream circuit is
// unhealthy.
Errors.isUnhealthy = function isUnhealthy(codeName) {
    switch (codeName) {
        // not an indicator of bad health
        case 'BadRequest':
        case 'Cancelled':
            return false;

        case 'Unhealthy':
        case 'Timeout':
        case 'Busy':
        case 'Declined':
        case 'UnexpectedError':
        case 'NetworkError':
        case 'ProtocolError':
            return true;

        default:
            return null;
    }
};

Errors.shouldRetry = function shouldRetry(codeName, retryFlags) {
    switch (codeName) {
        case 'BadRequest':
        case 'Cancelled':
        case 'Unhealthy':
            return false;

        case 'Busy':
        case 'Declined':
            return true;

        case 'Timeout':
            return !!retryFlags.onTimeout;

        case 'NetworkError':
        case 'ProtocolError':
        case 'UnexpectedError':
            return !!retryFlags.onConnectionError;

        default:
            return null;
    }
};

function HTTPInfo(statusCode, statusMessage) {
    this.statusCode = statusCode;
    this.statusMessage = statusMessage;
}

Errors.toHTTPCode = function toHTTPCode(codeName) {
    switch (codeName) {
        case 'Cancelled':
            return new HTTPInfo(500, 'TChannel Cancelled');

        case 'Unhealthy':
        case 'Declined':
            return new HTTPInfo(503, 'Service Unavailable');

        case 'Timeout':
            return new HTTPInfo(504, 'Gateway Timeout');

        case 'BadRequest':
            return new HTTPInfo(400, 'Bad Request');

        case 'Busy':
            return new HTTPInfo(429, 'Too Many Requests');

        case 'ProtocolError':
            return new HTTPInfo(500, 'TChannel Protocol Error');

        case 'NetworkError':
            return new HTTPInfo(500, 'TChannel Network Error');

        case 'UnexpectedError':
            return new HTTPInfo(500, 'TChannel Unexpected Error');

        default:
            return new HTTPInfo(500, 'Internal Server Error');
    }
};

Errors.isFatal = function isFatal(err, codeName) {
    if (!codeName) {
        codeName = Errors.classify(err);
    }
    switch (codeName) {
        case 'Busy':
        case 'Cancelled':
        case 'Declined':
        case 'NetworkError':
        case 'Timeout':
        case 'Unhealthy':
            return false;

        case 'BadRequest':
        case 'ProtocolError':
        case 'UnexpectedError':
            return true;

        default:
            return true;
    }
};

/*eslint complexity: [2, 15]*/
Errors.logLevel = function errorLogLevel(err, codeName) {
    switch (codeName) {
        case 'ProtocolError':
        case 'UnexpectedError':
            if (err.isErrorFrame || Errors.isParseError(err)) {
                return 'warn';
            }
            return 'error';

        case 'Busy':
        case 'Cancelled':
        case 'Declined':
        case 'NetworkError':
        case 'Unhealthy':
            return 'warn';

        case 'BadRequest':
        case 'Timeout':
            return 'info';

        default:
            return 'error';
    }
};

/*  Whether we should increase peer.pending on an error frame.

    On Busy & Declined we increase the pending count for a peer
    to allow peer selection to favor less loaded peers.
*/
Errors.isPendingError = function isPendingError(codeName) {
    switch (codeName) {
        case 'Busy':
        case 'Declined':
        case 'Unhealthy':
            return true;

        case 'BadRequest':
        case 'Cancelled':
        case 'NetworkError':
        case 'ProtocolError':
        case 'Timeout':
        case 'UnexpectedError':
            return false;

        default:
            return false;
    }
};

Errors.isParseError = function isParseError(error) {
    return error.isParseError || false;
};
