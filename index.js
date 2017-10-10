'use strict';
const async_hooks = require('async_hooks');
const EventEmitter = require('events');
const util = require('util');

process.domain = null;
const stack = []; // TODO
function bound(_this, self, cb, fnargs) {

    let ret;

    self.enter();
    if (fnargs.length > 0)
        ret = cb.apply(_this, fnargs);
    else
        ret = cb.call(_this);
    self.exit();

    return ret;
}

function intercepted(_this, self, cb, fnargs) {

    if (fnargs[0] && fnargs[0] instanceof Error) {
        const er = fnargs[0];
        util._extend(er, {
            domainBound: cb,
            domainThrown: false,
            domain: self
        });
        self.emit('error', er);
        return;
    }

    const args = [];
    let i, ret;

    self.enter();
    if (fnargs.length > 1) {
        for (i = 1; i < fnargs.length; i++)
            args.push(fnargs[i]);
        ret = cb.apply(_this, args);
    } else {
        ret = cb.call(_this);
    }
    self.exit();

    return ret;
}

class Domain extends EventEmitter {

    static create() {

        const domain = new Domain();
        domain.enable();
        return domain;
    }

    constructor() {
        super();
        this.ids = new Set();
        this.members = new Set();
    }


    enable() {

        const self = this;
        this.asyncHook = async_hooks.createHook({
            init(asyncId) {

                if (process.domain === self) { // if this operation is created while in a domain, let's mark it
                    self.ids.add(asyncId);
                }
            },
            before(asyncId) {

                if (self.ids.has(asyncId)) { // enter domain for this cb
                    process.domain = self;
                }
            },
            after(asyncId) {

                if (self.ids.has(asyncId)) { // remove domain for this cb
                    process.domain = null;
                }
            },
            destroy(asyncId) {

                self.ids.delete(asyncId); // cleaning up
            }
        });

        this.asyncHook.enable();
    }

    run(cb) {

        this.enter();
        cb();
        this.exit();
    }

    enter() {
        process.domain = this;
    }

    exit() {
        process.domain = null;
    }

    bind(cb) {

        const self = this;

        function runBound() {
            return bound(this, self, cb, arguments);
        }

        runBound.domain = this;

        return runBound;
    }

    intercept(cb) {

        var self = this;

        function runIntercepted() {
            return intercepted(this, self, cb, arguments);
        }

        return runIntercepted;
    }

    add(ee) {
        // If the domain is already added, then nothing left to do.
        if (ee.domain === this)
            return;

        // has a domain already - remove it first.
        if (ee.domain)
            ee.domain.remove(ee);

        // check for circular Domain->Domain links.
        // This causes bad insanity!
        //
        // For example:
        // var d = domain.create();
        // var e = domain.create();
        // d.add(e);
        // e.add(d);
        // e.emit('error', er); // RangeError, stack overflow!
        if (this.domain && (ee instanceof Domain)) {
            for (let d = this.domain; d; d = d.domain) {
                if (ee === d) return;
            }
        }

        ee.domain = this;
        this.members.add(ee);
    };

    remove(ee) {
        ee.domain = null;
        this.members.delete(ee);
    };
}

process.on('uncaughtException', (err) => {

    if (process.domain !== null) {

        process.domain.emit('error', err);
        return;
    }
    throw err;
});

setInterval(() => {}, 100000);

const domain = Domain.create();
const domain2 = Domain.create();

domain.on('error', (err) => {

    console.log('domain error', err);
});

domain2.on('error', (err) => {

    console.log('domain2 error', err);
});


domain.run(() => {

    setTimeout(() => {

        throw new Error('my error');
    });
});

const func1 = () => {
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            throw new Error('foo');
        });
    });
};


const func2 = () => {
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            setImmediate(() => {
                throw new Error('thrown');
            });
            return reject('reject');
        });
    });
};

const func3 = () => {
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            return resolve('resolve');
        });
    });
};

const main = async () => {
    try {
        await func1();
    } catch (ex) {
        console.log('caught throw in func1');
    }

    try {
        await func2();
    } catch (ex) {
        console.log('caught rejection in func2');
    }

    try {
        console.log(await func3());
    } catch (ex) {
        console.log('caught throw in func2');
    }
}

domain2.run(() => {

    main();
})

