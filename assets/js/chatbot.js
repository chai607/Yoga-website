(function () {
	"use strict";

	// Root buttons container
	function ensureRoot() {
		let root = document.getElementById("assistant-widgets-root");
		if (!root) {
			root = document.createElement("div");
			root.id = "assistant-widgets-root";
			document.body.appendChild(root);
		}
		return root;
	}

	// Utilities
	function stripHtmlToText(htmlString) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(htmlString, "text/html");
		// Remove scripts/styles/navs
		doc.querySelectorAll("script,style,noscript,iframe").forEach(el => el.remove());
		const text = doc.body ? doc.body.textContent || "" : "";
		return text.replace(/\s+/g, " ").trim();
	}

	function sentences(text) {
		// Very simple sentence splitter
		return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
	}

	function getSameOriginLinks(limit) {
		const origin = window.location.origin;
		const urls = new Set();
		document.querySelectorAll("a[href]").forEach(a => {
			try {
				const u = new URL(a.getAttribute("href"), origin);
				if (u.origin === origin) {
					// Skip file downloads and mailto/tel
					if (/^(mailto:|tel:)/i.test(a.getAttribute("href"))) return;
					// Skip fragments only
					if (u.hash && u.pathname === window.location.pathname) return;
					urls.add(u.toString());
				}
			} catch (_e) {}
		});
		return Array.from(urls).slice(0, limit);
	}

	function extractPhoneFromPage() {
		// Priority: data-mentor-phone on body
		const fromAttr = document.body.getAttribute("data-mentor-phone");
		if (fromAttr && /\d{7,}/.test(fromAttr)) {
			return fromAttr;
		}
		// Fallback: scan text for a phone-like pattern
		const raw = document.body ? document.body.innerText : document.documentElement.innerText;
		const match = raw && raw.match(/(\+?\d[\d\s\-()]{7,})/);
		return match ? match[1] : null;
	}

	function toWhatsAppNumber(rawPhone) {
		return (rawPhone || "").replace(/[^\d]/g, "");
	}

	// UI: Chat widget
	function createChatPanel() {
		const panel = document.createElement("section");
		panel.className = "assistant-panel";
		panel.id = "assistant-chatbot";

		panel.innerHTML = [
			'<header>',
			'<span>Yoga Assistant</span>',
			'<button class="assistant-close" aria-label="Close" title="Close">&times;</button>',
			'</header>',
			'<main>',
			'<div id="chatbot-messages" role="log" aria-live="polite"></div>',
			'<div id="chatbot-input-row">',
			'<input id="chatbot-input" type="text" placeholder="Ask about classes, timings, benefits, etc.">',
			'<button id="chatbot-send">Send</button>',
			'</div>',
			'<div class="assistant-small">Answers are generated from this website’s content.</div>',
			'</main>'
		].join("");

		document.body.appendChild(panel);

		panel.querySelector(".assistant-close").addEventListener("click", () => {
			panel.style.display = "none";
		});

		return panel;
	}

	function appendMsg(type, text, html) {
		const log = document.getElementById("chatbot-messages");
		if (!log) return;
		const item = document.createElement("div");
		item.className = "chat-msg " + (type === "user" ? "user" : "bot");
		if (html) {
			item.innerHTML = html;
		} else {
			item.textContent = text;
		}
		log.appendChild(item);
		log.scrollTop = log.scrollHeight;
	}

	// Simple site indexing using MiniSearch
	const Search = window.MiniSearch;
	let miniSearch = null;
	let documents = [];
	let isIndexReady = false;

	async function fetchDoc(url) {
		try {
			const res = await fetch(url, { credentials: "same-origin" });
			if (!res.ok) return null;
			const html = await res.text();
			const text = stripHtmlToText(html);
			// Title extraction
			const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
			const title = titleMatch ? titleMatch[1].trim() : url;
			return { id: url, url, title, content: text };
		} catch (_e) {
			return null;
		}
	}

	function buildMiniSearchIndex() {
		miniSearch = new Search({
			fields: ["title", "content"],
			storeFields: ["title", "url", "content"],
			searchOptions: {
				boost: { title: 2, content: 1 },
				fuzzy: 0.2,
				prefix: true
			}
		});
		miniSearch.addAll(documents);
		isIndexReady = true;
	}

	async function buildIndex() {
		// Seed with current page (rendered DOM text for immediate availability)
		const hereText = stripHtmlToText(document.documentElement.outerHTML);
		documents.push({ id: window.location.href, url: window.location.href, title: document.title || "Current page", content: hereText });

		// Crawl some same-origin links (limit to avoid heavy loads)
		const links = getSameOriginLinks(25);
		const fetched = await Promise.all(links.map(fetchDoc));
		for (const doc of fetched) {
			if (doc && doc.content && doc.content.length > 30) {
				documents.push(doc);
			}
		}
		buildMiniSearchIndex();
	}

	function topSnippetsFor(query, doc, maxSnippets) {
		const q = query.toLowerCase().split(/\s+/).filter(Boolean);
		const sents = sentences(doc.content);
		const scored = sents.map((s, i) => {
			const low = s.toLowerCase();
			let score = 0;
			for (const term of q) {
				if (!term) continue;
				// frequency and presence
				const matches = low.match(new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"));
				if (matches) score += matches.length * 2;
				if (low.includes(term)) score += 1;
			}
			// prefer mid-length sentences
			const len = s.length;
			const lenPenalty = Math.abs(140 - len) / 140;
			score -= lenPenalty;
			return { idx: i, s, score };
		});
		scored.sort((a, b) => b.score - a.score);
		const chosen = scored.slice(0, maxSnippets).map(x => x.s);
		return chosen;
	}

	function detectMentorIntent(text) {
		return /\b(mentor|trainer|coach|contact|connect|whats?app|speak|call)\b/i.test(text);
	}

	function connectToMentor(messageContext) {
		const raw = extractPhoneFromPage();
		const digits = toWhatsAppNumber(raw || "");
		const msg = messageContext || "Hello, I would like to connect with the yoga mentor.";
		if (digits && digits.length >= 8) {
			const wa = "https://wa.me/" + digits + "?text=" + encodeURIComponent(msg);
			window.open(wa, "_blank", "noopener");
			appendMsg("bot", "", 'Opening WhatsApp chat with the mentor. If it didn’t open, <a href="' + wa + '" target="_blank" rel="noopener">click here</a>.');
		} else {
			appendMsg("bot", "I couldn’t find a mentor phone number on this page. Please add data-mentor-phone on <body> or include the number in page content.");
		}
	}

	async function handleQuestion(q) {
		if (!q || !q.trim()) return;
		appendMsg("user", q);

		// Fast path: mentor connect
		if (detectMentorIntent(q)) {
			connectToMentor("Hello, I am visiting the Yoga website and want to connect with the mentor.");
			return;
		}

		if (!isIndexReady) {
			appendMsg("bot", "Give me a moment while I scan this site...");
			// Wait for index to be ready (it was started at load)
			let waited = 0;
			while (!isIndexReady && waited < 8000) {
				// eslint-disable-next-line no-await-in-loop
				await new Promise(r => setTimeout(r, 250));
				waited += 250;
			}
		}

		if (!miniSearch) {
			appendMsg("bot", "I couldn’t initialize the knowledge index. Please refresh the page.");
			return;
		}

		const results = miniSearch.search(q);
		if (!results || results.length === 0) {
			appendMsg("bot", "I couldn’t find that in the website content. Try rephrasing or ask about classes, schedules, pricing, benefits, or contact details.");
			return;
		}

		// Compose answer from top results
		const top = results.slice(0, 3).map(r => r);
		const parts = [];
		for (const r of top) {
			const doc = documents.find(d => d.id === r.id) || { title: r.title || r.id, url: r.id, content: "" };
			const snippets = topSnippetsFor(q, doc, 2);
			if (snippets.length) {
				parts.push(
					'<div><strong>' + (doc.title || "From page") + ':</strong> ' +
					snippets.map(s => s.replace(/</g, "&lt;")).join(" ") +
					' <a href="' + doc.url + '" target="_blank" rel="noopener">(open)</a></div>'
				);
			}
		}

		if (parts.length) {
			appendMsg("bot", "", parts.join(""));
		} else {
			appendMsg("bot", "I found some relevant pages but couldn’t extract a good snippet. Please open the links: " + top.map(t => t.id).join(", "));
		}
	}

	// Bootstrap
	function addFabButtons() {
		const root = ensureRoot();

		const chatBtn = document.createElement("button");
		chatBtn.className = "assistant-fab";
		chatBtn.id = "assistant-chat-fab";
		chatBtn.type = "button";
		chatBtn.textContent = "Chat with Yoga Assistant";
		root.appendChild(chatBtn);

		const bugBtn = document.createElement("button");
		bugBtn.className = "assistant-fab secondary";
		bugBtn.id = "assistant-bugfix-fab";
		bugBtn.type = "button";
		bugBtn.textContent = "Bug Fix Helper";
		root.appendChild(bugBtn);

		return { chatBtn, bugBtn };
	}

	function wireChat(panel) {
		const input = panel.querySelector("#chatbot-input");
		const send = panel.querySelector("#chatbot-send");

		function submit() {
			const v = input.value;
			input.value = "";
			handleQuestion(v);
		}

		send.addEventListener("click", submit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				submit();
			}
		});
	}

	let indexStarted = false;

	function init() {
		const { chatBtn } = addFabButtons();
		const panel = createChatPanel();
		wireChat(panel);

		chatBtn.addEventListener("click", () => {
			panel.style.display = panel.style.display === "block" ? "none" : "block";
			if (!indexStarted) {
				indexStarted = true;
				buildIndex(); // async, sets isIndexReady when done
			}
		});

		// Allow bugfix helper to toggle from its own script
		window.__assistantOpenBugfix = function () {
			const ev = new CustomEvent("assistant-open-bugfix");
			window.dispatchEvent(ev);
		};
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
