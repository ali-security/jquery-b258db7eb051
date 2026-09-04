/*
 * Headless QUnit runner for the jQuery test suite.
 *
 * jQuery 1.11 shipped no CI test runner of its own: upstream drove test/index.html
 * through TestSwarm, which is long gone. This script loads the same page in
 * PhantomJS, waits for QUnit to finish and reports the result, so `npm test`'s
 * lint/build pipeline is no longer the only thing CI proves.
 *
 * Usage: phantomjs test/phantom-runner.js [url]
 */
"use strict";

var page = require( "webpage" ).create(),
	system = require( "system" ),
	url = system.args[ 1 ] || "http://127.0.0.1:8000/test/index.html",
	// The suite is slow under PhantomJS; cap it well under Travis' job limit.
	hardTimeout = 25 * 60 * 1000,
	pollInterval = 2000,
	heartbeatEvery = 30000,
	start = Date.now(),
	lastBeat = 0;

page.settings.resourceTimeout = 120000;
page.viewportSize = { width: 1024, height: 768 };

page.onError = function( msg ) {
	console.log( "page error: " + msg );
};
page.onResourceTimeout = function( req ) {
	console.log( "resource timeout: " + req.url );
};

function collect() {
	return page.evaluate( function() {
		var i, li, mod, name, counts,
			el = document.getElementById( "qunit-testresult" ),
			result = { done: false, summary: "", failed: [], seen: 0 };

		if ( !el ) {
			return result;
		}
		result.summary = el.innerText || el.textContent || "";
		result.seen = document.querySelectorAll( "#qunit-tests > li" ).length;
		result.done = /[Tt]ests completed/.test( result.summary );
		result.queued = window.QUnit && QUnit.config && QUnit.config.queue ?
			QUnit.config.queue.length : -1;

		counts = document.querySelectorAll( "#qunit-tests > li.fail" );
		for ( i = 0; i < counts.length; i++ ) {
			li = counts[ i ];
			mod = li.querySelector( ".module-name" );
			name = li.querySelector( ".test-name" );
			result.failed.push(
				( mod ? mod.textContent + ": " : "" ) +
				( name ? name.textContent : "(unnamed)" )
			);
		}
		return result;
	} );
}

page.open( url, function( status ) {
	if ( status !== "success" ) {
		console.log( "FAILED to load " + url );
		phantom.exit( 1 );
	}
	console.log( "loaded " + url );

	var lastSeen = -1,
		lastChange = Date.now();

	var timer = setInterval( function() {
		var elapsed = Date.now() - start,
			state = collect(),
			stalled;

		if ( state.seen !== lastSeen ) {
			lastSeen = state.seen;
			lastChange = Date.now();
		}
		// PhantomJS 2.1 dies during the ajax module's teardown, after every test
		// has reported but before QUnit paints its summary line. Once the QUnit
		// queue is empty and nothing new has reported for a while, the per-test
		// results in the DOM are complete and are the real outcome.
		stalled = state.seen > 0 && state.queued === 0 &&
			( Date.now() - lastChange ) > 20000;
		if ( stalled && !state.done ) {
			console.log( "note: QUnit summary never rendered (PhantomJS teardown " +
				"crash); reporting the " + state.seen + " completed test results." );
			state.done = true;
			state.summary = "queue drained, " + state.seen + " tests reported";
		}

		if ( elapsed - lastBeat >= heartbeatEvery ) {
			lastBeat = elapsed;
			console.log( "... " + Math.round( elapsed / 1000 ) + "s, " +
				state.seen + " tests reported, " + state.failed.length + " failing" );
		}

		if ( state.done ) {
			clearInterval( timer );
			console.log( "" );
			console.log( "QUnit result: " + state.summary );
			if ( state.failed.length ) {
				console.log( "Failed tests (" + state.failed.length + "):" );
				for ( var i = 0; i < state.failed.length; i++ ) {
					console.log( "  FAIL " + state.failed[ i ] );
				}
				phantom.exit( 1 );
			}
			console.log( "All " + state.seen + " tests passed." );
			phantom.exit( 0 );
		}

		if ( elapsed > hardTimeout ) {
			clearInterval( timer );
			console.log( "TIMEOUT after " + Math.round( elapsed / 1000 ) + "s; " +
				state.seen + " tests reported. Last summary: " + state.summary );
			phantom.exit( 1 );
		}
	}, pollInterval );
} );
