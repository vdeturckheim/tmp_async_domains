'use strict';
const async_hooks = require('async_hooks');
const events = require('events');

process.domain = null;
class Domain extends events{

    static create() {

        const domain = new Domain();
        domain.enable();
        return domain;
    }

    constructor() {
        super();

        this.ids = new Set();
    }


    enable() {

        const self = this;
        this.asyncHook = async_hooks.createHook({
            init(asyncId, type, triggerAsyncId) {

                if (self.ids.has(triggerAsyncId)) { // if parent is in the domain, the child has to be too.
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

                self.ids.delete(asyncId);
            },
            promiseResolve(asyncId) {

            }
        });

        this.asyncHook.enable();
    }

    run(cb) {

        process.nextTick(() => {

            this.ids.add(async_hooks.executionAsyncId());
            cb();
        });
    }

    enter() {
        process.domain = this;
    }

    exit() {
        process.domain = null;
    }

    bind(cb) {

        const self = this;
        return function () {

            self.run(() => {

                self.enter();
                cb.apply(this, arguments);
                self.exit();
            });
        }
    }

    intercept(cb) {

        throw new Error('not implemented yet');
    }

    add(emitter) {

        throw new Error('not implemented yet');
    }

    remove(emitter) {

        throw new Error('not implemented yet');
    }
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

