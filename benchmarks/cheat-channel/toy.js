'use strict';

/* @flow */
var console = require('console');
/*eslint no-console: 0*/

/*::
declare interface FooC extends FooObj {
    constructor(arg: string): FooObj;
    static (arg: string): void;
}

declare interface FooObj {
    arg: string;

    bar: (foo: string) => string;
}

type FooFn = (arg: string) => void;

declare var Foo : Class<FooC>;
*/

/*::var x:FooFn =*/
function Foo(arg) {
    var self/*:FooObj*/ = this;

    /*:: (arg: number) */ // type error

    self.arg = arg;

    /*:: self.wat(); */ // type error
}

Foo.prototype.bar = function bar(foo) {
    var self/*:FooObj*/ = this;

    /*:: (foo: number) */ // type error

    /*:: self.wat(); */ // type error

    /*:: return 42; */ // type error

    return foo + self.arg;
};

var f = new Foo('foo');
console.log(f.bar('bar'), f.arg);

var f2 = Foo('foo');
console.log(f2.bar('bar'), f2.arg); // type error
