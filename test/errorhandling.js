var testBase = require('tape');
var mobx = require('..');
var m = mobx;

var observable = mobx.observable;
var computed = mobx.computed;

var voidObserver = function(){};

function test(name, func) {
    testBase(name, function(t) {
        try {
            func(t);
        } finally {
            mobx._.resetGlobalState();
        }
    });
}

function buffer() {
    var b = [];
    var res = function(newValue) {
        b.push(newValue);
    };
    res.toArray = function() {
        return b;
    };
    return res;
}

function checkGlobalState(t) {
	const gs = global.__mobxGlobal;
	t.equal(gs.trackingDerivation, null)
	t.equal(gs.inTransaction, 0)
	t.equal(gs.isRunningReactions, false)
	t.equal(gs.inBatch, 0)
	t.equal(gs.allowStateChanges, !gs.strictMode)
	t.equal(gs.pendingUnobservations.length, 0)
}

test('exception1', function(t) {
    var a = computed(function() {
        throw "hoi";
    });
    t.throws(() => a(), "hoi");
	checkGlobalState(t);
    t.end();
})

test('deny state changes in views', function(t) {
    var x = observable(3);
    var z = observable(5);
    var y = observable(function() {
        z(6);
        return x() * x();
    });


    t.throws(() => {
        y()
    }, 'It is not allowed to change the state during the computation of a reactive view');

	checkGlobalState(t);
    t.end();
})

test('allow state changes in autorun', function(t) {
    var x = observable(3);
    var z = observable(3);

    m.autorun(function() {
        if (x.get() !== 3)
            z.set(x.get());
    });

    t.equal(x.get(), 3);
    t.equal(z.get(), 3);

    x.set(5); // autorunneres are allowed to change state

    t.equal(x.get(), 5);
    t.equal(z.get(), 5);

    t.equal(mobx.extras.isComputingDerivation(), false);
	checkGlobalState(t);
    t.end();
})

test('deny array change in view', function(t) {
    try {
        var x = observable(3);
        var z = observable([]);
        var y = observable(function() {
            z.push(3);
            return x() * x();
        });

        t.throws(function() {
            t.equal(9, y());
        }, 'It is not allowed to change the state during the computation of a reactive derivation');

        t.deepEqual(z.slice(), []);
        t.equal(mobx.extras.isComputingDerivation(), false);

		checkGlobalState(t);
        t.end();
    }
    catch(e) {
        console.log(e.stack);
    }
})

test('allow array change in autorun', function(t) {
    var x = observable(3);
    var z = observable([]);
    var y = m.autorun(function() {
        if (x.get() > 4)
            z.push(x.get());
    });

    x.set(5);
    x.set(6);
    t.deepEqual(z.slice(), [5, 6])
    x.set(2);
    t.deepEqual(z.slice(), [5, 6])

    t.equal(mobx.extras.isComputingDerivation(), false);
	checkGlobalState(t);
    t.end();
})

test('throw error if modification loop', function(t) {
    var x = observable(3);
    var dis = m.autorun(function() {
        x.set(x.get() + 1); // is allowed to throw, but doesn't as the observables aren't bound yet during first execution
    });
    t.throws(() => {
        x.set(5);
    }, "Reaction doesn't converge to a stable state")
	checkGlobalState(t);
    t.end();
})

test('cycle1', function(t) {
    t.throws(() => {
        var p = observable(function() { return p() * 2; }); // thats a cycle!
        p.observe(voidObserver, true);
    }, "Found cyclic dependency");
	checkGlobalState(t);
    t.end();
})

test('cycle2', function(t) {
    var a = observable(function() { return b.get() * 2; });
    var b = observable(function() { return a.get() * 2; });
    t.throws(() => {
        b.get()
    }, "Found cyclic dependency");
	checkGlobalState(t);
    t.end();
})

test('cycle3', function(t) {
    var p = observable(function() { return p.get() * 2; });
    t.throws(() => {
        p.get();
    }, "Found cyclic dependency");
	checkGlobalState(t);
    t.end();
})

test('cycle3', function(t) {
    var z = observable(true);
    var a = observable(function() { return z.get() ? 1 : b.get() * 2; });
    var b = observable(function() { return a.get() * 2; });

    m.observe(b, voidObserver);
    t.equal(1, a.get());

    t.throws(() => {
        z.set(false); // introduces a cycle!
    }, "Found cyclic dependency");
	checkGlobalState(t);
    t.end();
});

test('issue 86, converging cycles', function(t) {
    function findIndex(arr, predicate) {
        for (var i = 0, l = arr.length; i < l; i++)
            if (predicate(arr[i]) === true)
                return i;
        return -1;
    }

    const deleteThisId = mobx.observable(1);
    const state = mobx.observable({ someArray: [] });
    var calcs = 0;

    state.someArray.push({ id: 1, text: 'I am 1' });
    state.someArray.push({ id: 2, text: 'I am 2' });

    // should delete item 1 in first run, which works fine
    mobx.autorun(() => {
        calcs++;
        const i = findIndex(state.someArray, item => item.id === deleteThisId.get());
        state.someArray.remove(state.someArray[i]);
    });

    t.equal(state.someArray.length, 1); // should be 1, which prints fine
    t.equal(calcs, 1);
    deleteThisId.set(2); // should delete item 2, but it errors on cycle

    t.equal(console.log(state.someArray.length, 0)); // should be 0, which never prints
    t.equal(calcs, 3);

	checkGlobalState(t);
    t.end();
});

test('slow converging cycle', function(t) {
    var x = mobx.observable(1);
    var res = -1;
    mobx.autorun(() => {
        if (x.get() === 100)
            res = x.get();
        else
            x.set(x.get() + 1);
    });

    // ideally the outcome should be 100 / 100.
    // autorun is only an observer of x *after* the first run, hence the initial outcome is not as expected..
    // is there a practical use case where such a pattern would be expected?
    // maybe we need to immediately register observers on the observable? but that would be slow....
    // or detect cycles and re-run the autorun in that case once?
    t.equal(x.get(), 2)
    t.equal(res, -1);

    x.set(7);
    t.equal(x.get(), 100)
    t.equal(res, 100);

	checkGlobalState(t);
    t.end();
});

test('error handling assistence ', function(t) {
    var baseError = console.error;
	var baseWarn = console.warn;
    var errors = []; // logged errors
    var warns = [];  // logged warns
	var values = []; // produced errors
    var thrown = []; // list of actually thrown exceptons

    console.error = function(msg) {
        baseError.apply(console, arguments);
        errors.push(msg);
    }
    console.warn = function(msg) {
        baseWarn.apply(console, arguments);
        warns.push(msg);
    }

    var a = observable(3);
    var b = computed(function() {
        if (a.get() === 42)
            throw 'should not be 42';
        return a.get() * 2;
    });

    var c = m.autorun(function() {
        values.push(b.get());
    });

    a.set(2);
    try{
        a.set(42);
    } catch (e) {
        thrown.push(e);
    }
    a.set(7);

    // Test recovery
    setTimeout(function() {
        a.set(4);
        try {
            a.set(42);
        } catch (e) {
            thrown.push(e);
        }

        t.deepEqual(values, [6, 4, 14, 8]);
        t.equal(errors.length, 0);
		t.equal(warns.length, 2);
        t.equal(thrown.length, 2);

        console.error = baseError;
		console.warn = baseWarn;

		checkGlobalState(t);
        t.end();
    }, 10);
})

test('236 - cycles', t => {
	var Parent = function() {
		m.extendObservable(this, {
			children: [],
			total0: function() {
				// Sum "value" of children of kind "0"
				return this.children.filter(c => c.kind === 0).map(c => c.value).reduce((a, b) => a+b, 0);
			},
			total1: function() {
				// Sum "value" of children of kind "1"
				return this.children.filter(c => c.kind === 1).map(c => c.value).reduce((a, b) => a+b, 0);
			}
		});
	};

	var Child = function(parent, kind) {
		this.parent = parent;
		m.extendObservable(this, {
			kind: kind,
			value: function() {
				if (this.kind === 0) {
					return 3;
				} else {
					// Value of child of kind "1" depends on the total value for all children of kind "0"
					return this.parent.total0 * 2;
				}
			}
		});
	};

	const parent = new Parent();
	parent.children.push(new Child(parent, 0));
	parent.children.push(new Child(parent, 0));
	parent.children.push(new Child(parent, 0));

	var msg = [];
	var d = m.autorun(() => {
		msg.push('total0:', parent.total0, 'total1:', parent.total1);
	});
	// So far, so good: total0: 9 total1: 0
	t.deepEqual(msg, ["total0:", 9, "total1:", 0])
	parent.children[0].kind = 1;
	t.deepEqual(msg, [
		"total0:", 9, "total1:", 0,
		"total0:", 6, "total1:", 12
	])

	checkGlobalState(t);
	t.end();
})

test('peeking inside erroring computed value doesn\'t bork (global) state', t => {
	const a = mobx.observable(1)
	const b = mobx.computed(() => {
		a.get()
		throw "chocolademelk"
	})

	t.throws(() => {
		b.get()
	}, /chocolademelk/)

	t.equal(a.isPendingUnobservation, true) // true is a default for optimization
	t.equal(a.isObserved, false)
	t.equal(a.observers.length, 0)
	t.deepEqual(a.observerIndexes, undefined)
	t.equal(a.diffValue, 0)
	t.equal(a.lowestObserverState, -1)
	t.equal(a.hasUnreportedChange, false)
	t.equal(a.value, 1)

	t.equal(b.dependenciesState, 0)
	t.equal(b.observing.length, 0)
	t.equal(b.newObserving, null)
	t.equal(b.isPendingUnobservation, false)
	t.equal(b.isObserved, false)
	t.equal(b.observers.length, 0)
	t.deepEqual(b.observerIndexes, undefined)
	t.equal(b.diffValue, 0)
	t.equal(b.lowestObserverState, 0)
	t.equal(b.unboundDepsCount, 0)
	t.equal(b.value, undefined)
	t.equal(b.isComputing, false)

	checkGlobalState(t)

	t.end()
})


test('peeking inside autorun doesn\'t bork (global) state', t => {
	var r = -1
	const a = mobx.observable(1)
	const b = mobx.computed(() => {
		const res = r = a.get()
		if (res === 2)
			throw "chocolademelk"
		return res
	})
	const d = mobx.autorun(() => b.get())
	const c = d.$mobx;

	t.equal(b.get(), 1)
	t.equal(r, 1)

	test("it should update correctly initially", t => {
		t.equal(a.isPendingUnobservation, true) // true is a default for optimization
		t.equal(a.isObserved, false) // should be true?
		t.equal(a.observers.length, 1)
		t.deepEqual(a.observerIndexes, undefined) // is this correct?!
		t.equal(a.diffValue, 0)
		t.equal(a.lowestObserverState, -1)
		t.equal(a.hasUnreportedChange, false)
		t.equal(a.value, 1)

		t.equal(b.dependenciesState, 0)
		t.equal(b.observing.length, 1)
		t.equal(b.newObserving, null)
		t.equal(b.isPendingUnobservation, false)
		t.equal(b.isObserved, false)
		t.equal(b.observers.length, 1)
		t.deepEqual(b.observerIndexes, undefined) // is this correct?
		t.equal(b.diffValue, 0)
		t.equal(b.lowestObserverState, 0)
		t.equal(b.unboundDepsCount, 1) // is this correct?
		t.equal(b.value, 1, "value should be 1")
		t.equal(b.isComputing, false)

		t.equal(c.dependenciesState, 0)
		t.equal(c.observing.length, 1)
		t.equal(c.newObserving, null)
		t.equal(c.diffValue, 0)
		t.equal(c.unboundDepsCount, 1) // is this correct?
		t.equal(c.isDisposed, false)
		t.equal(c._isScheduled, false)
		t.equal(c._isTrackPending, false)
		t.equal(c._isRunning, false)
		checkGlobalState(t)
		t.end()
	})

	test("it should not break internal consistency when exception occurred", t => {
		// Trigger exception
		t.throws(() => { a.set(2) }, /chocolademelk/)
		t.equal(r, 2)

		t.equal(a.isPendingUnobservation, true) // true is a default for optimization
		t.equal(a.isObserved, false) // should be true?
		t.equal(a.observers.length, 1)
		t.deepEqual(a.observerIndexes, undefined) // is this correct?!
		t.equal(a.diffValue, 0)
		t.equal(a.lowestObserverState, 0)
		t.equal(a.hasUnreportedChange, false)
		t.equal(a.value, 2)

		t.equal(b.dependenciesState, 0) // up to date (for what it's worth)
		t.equal(b.observing.length, 1)
		t.equal(b.newObserving, null)
		t.equal(b.isPendingUnobservation, false)
		t.equal(b.isObserved, false) // should be true?
		t.equal(b.observers.length, 1)
		t.deepEqual(b.observerIndexes, undefined) // is this correct?
		t.equal(b.diffValue, 0)
		t.equal(b.lowestObserverState, 0)
		t.equal(b.unboundDepsCount, 0)
		t.equal(b.value, 1, "value should be 1")
		t.equal(b.isComputing, false)

		t.equal(c.dependenciesState, 0)
		t.equal(c.observing.length, 1)
		t.equal(c.newObserving, null)
		t.equal(c.diffValue, 0)
		t.equal(c.unboundDepsCount, 1) // is this correct?
		t.equal(c.isDisposed, false)
		t.equal(c._isScheduled, false)
		t.equal(c._isTrackPending, false)
		t.equal(c._isRunning, false)
		checkGlobalState(t)
		t.end()
	})

	// Trigger a new change, will this recover?
	// is this actually a supported case or should we just give up?
	test("it should recover from errors", t => {
		a.set(3)
		t.equal(r, 3, "recovered from error")

		t.equal(a.isPendingUnobservation, true) // true is a default for optimization
		t.equal(a.isObserved, false) // should be true?
		t.equal(a.observers.length, 1)
		t.deepEqual(a.observerIndexes, undefined) // is this correct?!
		t.equal(a.diffValue, 0)
		t.equal(a.lowestObserverState, 0)
		t.equal(a.hasUnreportedChange, false)
		t.equal(a.value, 3)

		t.equal(b.dependenciesState, 0) // up to date (for what it's worth)
		t.equal(b.observing.length, 1)
		t.equal(b.newObserving, null)
		t.equal(b.isPendingUnobservation, false)
		t.equal(b.isObserved, false) // should be true?
		t.equal(b.observers.length, 1)
		t.deepEqual(b.observerIndexes, undefined) // is this correct?
		t.equal(b.diffValue, 0)
		t.equal(b.lowestObserverState, 0)
		t.equal(b.unboundDepsCount, 1) // should be zero?
		t.equal(b.value, 3, "value should be 3")
		t.equal(b.isComputing, false)

		t.equal(c.dependenciesState, 0)
		t.equal(c.observing.length, 1)
		t.equal(c.newObserving, null)
		t.equal(c.diffValue, 0)
		t.equal(c.unboundDepsCount, 1) // is this correct?
		t.equal(c.isDisposed, false)
		t.equal(c._isScheduled, false)
		t.equal(c._isTrackPending, false)
		t.equal(c._isRunning, false)

		checkGlobalState(t)
		t.end()
	})

	test("it should clean up correctly", t => {
		d()

		t.equal(a.isPendingUnobservation, true) // true is a default for optimization
		t.equal(a.isObserved, false)
		t.equal(a.observers.length, 0)
		t.deepEqual(a.observerIndexes, undefined) // is this correct?!
		t.equal(a.diffValue, 0)
		t.equal(a.lowestObserverState, 0)
		t.equal(a.hasUnreportedChange, false)
		t.equal(a.value, 3)

		t.equal(b.dependenciesState, -1) // not tracking
		t.equal(b.observing.length, 0)
		t.equal(b.newObserving, null)
		t.equal(b.isPendingUnobservation, false)
		t.equal(b.isObserved, false)
		t.equal(b.observers.length, 0)
		t.deepEqual(b.observerIndexes, undefined) // is this correct?
		t.equal(b.diffValue, 0)
		t.equal(b.lowestObserverState, 0)
		t.equal(b.unboundDepsCount, 1) // should be zero?
		t.equal(b.value, undefined)
		t.equal(b.isComputing, false)

		t.equal(c.dependenciesState, -1)
		t.equal(c.observing.length, 0)
		t.equal(c.newObserving, null)
		t.equal(c.diffValue, 0)
		t.equal(c.unboundDepsCount, 1) // is this correct?
		t.equal(c.isDisposed, true)
		t.equal(c._isScheduled, false)
		t.equal(c._isTrackPending, false)
		t.equal(c._isRunning, false)

		t.equal(b.get(), 3)

		checkGlobalState(t)
		t.end()
	})

	t.end()
})
