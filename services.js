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

var errors = require('./errors');

function TChannelServices() {
    // Maps service name with '$' prefix to service tracking object.
    // The prefix ensures that we cannot be lost or confused if some joker
    // names their service 'toString' or '__proto__'.
    // '_' as a prefix would still be confused by '_proto__', '__' would be
    // confused by 'proto__'.
    this.services = {};
    this.maxPendingForService = Infinity;
    this.maxPending = Infinity;
    this.pending = 0;
}

TChannelServices.prototype.errorIfExceedsMaxPending = function errorIfExceedsMaxPending(req) {
    if (this.pending >= this.maxPending) {
        return errors.MaxPendingError({
            pending: this.pending
        });
    }
    if (!req.serviceName) {
        return null;
    }
    var serviceKey = '$' + req.serviceName;
    var service = this.services[serviceKey];
    return service && service.errorIfExceedsMaxPending();
};

TChannelServices.prototype.onRequest = function onRequest(req) {
    this.pending++;
    if (!req.serviceName) {
        return;
    }
    var serviceKey = '$' + req.serviceName;
    var service = this.services[serviceKey];
    if (!service) {
        service = new TChannelService();
        service.serviceName = req.serviceName;
        if (this.maxPendingForService !== undefined) {
            service.maxPending = this.maxPendingForService;
        }
        this.services[serviceKey] = service;
    }
    service.onRequest();
};

TChannelServices.prototype.onRequestResponse = function onRequestResponse(req) {
    this.pending--;
    if (!req.serviceName) {
        return;
    }
    var serviceKey = '$' + req.serviceName;
    var service = this.services[serviceKey];
    service.onRequestResponse();
};

TChannelServices.prototype.onRequestError = function onRequestError(req) {
    this.pending--;
    if (!req.serviceName) {
        return;
    }
    var serviceKey = '$' + req.serviceName;
    var service = this.services[serviceKey];
    service.onRequestError();
};

function TChannelService() {
    this.serviceName = null;
    this.maxPending = Infinity;
    this.pending = 0;
}

TChannelService.prototype.errorIfExceedsMaxPending = function errorIfExceedsMaxPending() {
    if (this.pending >= this.maxPending) {
        return errors.MaxPendingForServiceError({
            serviceName: this.serviceName,
            pending: this.pending
        });
    }
};

TChannelService.prototype.onRequest = function onRequest() {
    this.pending += 1;
};

TChannelService.prototype.onRequestResponse = function onRequestResponse() {
    this.pending -= 1;
};

TChannelService.prototype.onRequestError = function onRequestError() {
    this.pending -= 1;
};

module.exports = TChannelServices;
