(function () {
	"use strict";

	function ensureRoot() {
		let root = document.getElementById("assistant-widgets-root");
		if (!root) {
			root = document.createElement("div");
			root.id = "assistant-widgets-root";
			document.body.appendChild(root);
		}
		return root;
	}

	function createBugfixPanel() {
		const panel = document.createElement("section");
		panel.className = "assistant-panel";
		panel.id = "assistant-bugfix";
		panel.style.right = "392px"; // so it doesn't overlap chat panel

		panel.innerHTML = [
			'<header>',
			'<span>Bug Fix Helper</span>',
			'<button class="assistant-close" aria-label="Close" title="Close">&times;</button>',
			'</header>',
			'<main>',
			'<textarea id="bugfix-textarea" placeholder="Paste JavaScript code here..."></textarea>',
			'<div id="bugfix-actions">',
			'<button id="bugfix-analyze">Analyze</button>',
			'<button id="bugfix-autofix">Auto‑fix common issues</button>',
			'</div>',
			'<div class="assistant-small">Powered by JSHint (runs entirely in your browser).</div>',
			'<div id="bugfix-results" aria-live="polite"></div>',
			'</main>'
		].join("");

		document.body.appendChild(panel);
		panel.querySelector(".assistant-close").addEventListener("click", () => {
			panel.style.display = "none";
		});
		return panel;
	}

	function addBugFab() {
		const root = ensureRoot();
		let btn = document.getElementById("assistant-bugfix-fab");
		if (!btn) {
			btn = document.createElement("button");
			btn.className = "assistant-fab secondary";
			btn.id = "assistant-bugfix-fab";
			btn.type = "button";
			btn.textContent = "Bug Fix Helper";
			root.appendChild(btn);
		}
		return btn;
	}

	function renderResults(resultsEl, title, items) {
		const html = [
			"<strong>" + title + "</strong>",
			"<ul>",
			...items.map(li => "<li>" + li + "</li>"),
			"</ul>"
		].join("");
		resultsEl.innerHTML = html;
	}

	function analyze(code, resultsEl) {
		/* global JSHINT */
		if (typeof JSHINT !== "function") {
			resultsEl.textContent = "JSHint failed to load.";
			return;
		}
		const options = {
			esversion: 2021,
			curly: true,
			undef: true,
			unused: "vars",
			browser: true,
			devel: true,
			strict: false,
			eqeqeq: true
		};
		const globals = {}; // customize if needed
		JSHINT(code, options, globals);
		const data = JSHINT.data();
		const errors = (JSHINT.errors || []).filter(Boolean);

		const items = [];
		for (const e of errors) {
			const where = (e.line != null && e.character != null) ? ("L" + e.line + ":" + e.character) : "";
			items.push((where ? where + " - " : "") + (e.reason || "Issue") + (e.evidence ? " — " + e.evidence.trim() : ""));
		}

		// Suggestions for common codes
		const suggestions = [];
		if (errors.some(e => e.code === "W033")) {
			suggestions.push("Add missing semicolons at statement ends.");
		}
		if (errors.some(e => e.code === "W117")) {
			const implied = (data && data.implieds) ? data.implieds.map(i => i.name).join(", ") : "";
			suggestions.push("Declare missing variables with let/const: " + implied);
		}
		if (errors.some(e => e.code === "W116")) {
			suggestions.push("Use strict comparison (===/!==) instead of ==/!=.");
		}
		if (errors.some(e => e.code === "E033")) {
			suggestions.push("Check for unmatched braces or missing ) or }.");
		}

		const results = [];
		if (items.length === 0) {
			results.push("No issues detected.");
		} else {
			results.push("Found " + items.length + " issue(s).");
		}

		renderResults(resultsEl, results.join(" "), items.concat(suggestions.length ? ["Suggestions: " + suggestions.join(" ")] : []));
	}

	function autoFix(code) {
		// Very conservative auto-fixes
		let fixed = code;

		// 1) Replace == with === and != with !== (avoid already strict)
		fixed = fixed.replace(/([^=!<>])==([^=])/g, "$1===$2");
		fixed = fixed.replace(/!=([^=])/g, "!==$1");

		// 2) Add semicolons at end of non-empty lines lacking semicolon (naive)
		fixed = fixed.split("\n").map(line => {
			const trimmed = line.trim();
			if (!trimmed) return line;
			if (/;|\{|\}|\bif\b|\bfor\b|\bwhile\b|\bswitch\b|\belse\b|\btry\b|\bcatch\b|\bfunction\b/.test(trimmed)) return line;
			if (/[;:]$/.test(trimmed)) return line;
			return line + (line.endsWith(" ") ? ";" : " ;");
		}).join("\n");

		// 3) Declare implied globals at top
		try {
			/* global JSHINT */
			const options = { esversion: 2021, undef: true, unused: "vars" };
			JSHINT(fixed, options, {});
			const data = JSHINT.data();
			if (data && Array.isArray(data.implieds) && data.implieds.length) {
				const names = Array.from(new Set(data.implieds.map(i => i.name))).filter(Boolean);
				if (names.length) {
					const decl = "let " + names.join(", ") + ";\n";
					fixed = decl + fixed;
				}
			}
		} catch (_e) {
			// ignore
		}
		return fixed;
	}

	function init() {
		const panel = createBugfixPanel();
		const btn = addBugFab();

		const results = panel.querySelector("#bugfix-results");
		const ta = panel.querySelector("#bugfix-textarea");
		const analyzeBtn = panel.querySelector("#bugfix-analyze");
		const autofixBtn = panel.querySelector("#bugfix-autofix");

		btn.addEventListener("click", () => {
			panel.style.display = panel.style.display === "block" ? "none" : "block";
		});

		analyzeBtn.addEventListener("click", () => {
			analyze(ta.value, results);
		});

		autofixBtn.addEventListener("click", () => {
			const updated = autoFix(ta.value);
			ta.value = updated;
			analyze(updated, results);
		});

		// Open panel when chat script requests
		window.addEventListener("assistant-open-bugfix", () => {
			panel.style.display = "block";
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
