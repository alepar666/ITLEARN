(() => {
  "use strict";

  const STORAGE_KEY = "italienisch-b1-progress-v1";
  const SYNC_CODE_KEY = "italienisch-b1-sync-code-v1";
  const SYNC_PENDING_KEY = "italienisch-b1-sync-pending-code-v1";
  const SYNC_BACKUP_KEY = "italienisch-b1-pre-sync-progress-v1";
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;
  const $ = (selector) => document.querySelector(selector);
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const defaultState = () => ({ cards: {}, stats: { date: todayKey(), reviewedToday: 0, knownToday: 0 } });

  let progress = loadProgress();
  let session = null;
  let selectedStudyCategory = "random";
  let selectedCategory = "Alle";
  let deferredInstallPrompt = null;
  let feedbackAudioContext = null;
  let syncCode = readStoredSyncCode();
  let syncTimer = null;
  let syncPromise = null;
  let syncQueued = false;

  function loadProgress() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored && stored.cards && stored.stats) {
        delete stored.stats.streak;
        delete stored.stats.lastStudyDate;
        delete stored.stats.newSeenToday;
        return stored;
      }
    } catch (_) { /* A fresh local profile is created if storage is unavailable or unreadable. */ }
    return defaultState();
  }

  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }
    catch (_) { setDailyNote("Der Browserspeicher ist voll. Gib Speicherplatz frei, damit dein Lernfortschritt gespeichert werden kann."); }
  }

  function readStoredSyncCode() {
    try { return localStorage.getItem(SYNC_CODE_KEY) || ""; }
    catch (_) { return ""; }
  }

  function syncEndpoint() {
    const base = String(window.ITB1_SYNC_API || "").trim().replace(/\/+$/, "");
    return base ? `${base}/v1/progress` : "";
  }

  function setSyncMessage(message, isError = false) {
    const element = $("#sync-message");
    element.textContent = message;
    element.classList.toggle("error", isError);
    element.hidden = !message;
  }

  function setSyncStatus(message) {
    $("#sync-status").textContent = message;
  }

  function refreshSyncDialog() {
    const configured = Boolean(syncEndpoint());
    const linked = Boolean(syncCode);
    $("#sync-unlinked").hidden = linked;
    $("#sync-linked").hidden = !linked;
    $("#sync-create-button").disabled = !configured;
    $("#sync-join-button").disabled = !configured;
    $("#sync-code-display").textContent = syncCode;
    if (!configured) setSyncMessage("Der Onlinedienst muss noch eingerichtet werden.", true);
  }

  function syncHeaders(code) {
    return { "Authorization": `Bearer ${code}`, "Content-Type": "application/json" };
  }

  async function requestSyncApi(code, method, body = null) {
    const endpoint = syncEndpoint();
    if (!endpoint) throw new Error("Der Onlinedienst ist nicht eingerichtet.");
    const response = await fetch(endpoint, {
      method,
      headers: syncHeaders(code),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
    let result = {};
    try { result = await response.json(); } catch (_) { /* A status message is still shown for non-JSON responses. */ }
    if (!response.ok) {
      const error = new Error(result.error || `Synchronisierungsfehler (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function makeSyncCode() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function serializeProgress(value) {
    const cards = Object.fromEntries(Object.entries(value.cards || {}).sort(([a], [b]) => a.localeCompare(b)));
    const stats = value.stats || {};
    return JSON.stringify({
      cards,
      stats: {
        date: stats.date || "",
        reviewedToday: Number(stats.reviewedToday) || 0,
        knownToday: Number(stats.knownToday) || 0
      }
    });
  }

  function mergeProgress(localState, remoteState) {
    const localCards = localState?.cards || {};
    const remoteCards = remoteState?.cards || {};
    const cards = { ...remoteCards };
    for (const [key, localCard] of Object.entries(localCards)) {
      const remoteCard = remoteCards[key];
      const localReviewed = Number(localCard?.lastReviewed) || 0;
      const remoteReviewed = Number(remoteCard?.lastReviewed) || 0;
      if (!remoteCard || localReviewed >= remoteReviewed) cards[key] = localCard;
    }

    const localStats = localState?.stats || defaultState().stats;
    const remoteStats = remoteState?.stats || defaultState().stats;
    let stats;
    if (localStats.date > remoteStats.date) stats = { ...localStats };
    else if (remoteStats.date > localStats.date) stats = { ...remoteStats };
    else stats = {
      ...localStats,
      reviewedToday: Math.max(Number(localStats.reviewedToday) || 0, Number(remoteStats.reviewedToday) || 0),
      knownToday: Math.max(Number(localStats.knownToday) || 0, Number(remoteStats.knownToday) || 0)
    };
    return { cards, stats };
  }

  async function synchronizeProgress(code = syncCode) {
    if (!code || !syncEndpoint()) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      const cloud = await requestSyncApi(code, "GET");
      const merged = mergeProgress(progress, cloud.progress);
      progress = merged;
      saveProgress();
      const mergedJson = serializeProgress(merged);
      if (mergedJson === serializeProgress(cloud.progress)) {
        setSyncStatus("Lernfortschritt synchronisiert.");
        updateDashboard();
        return;
      }
      try {
        await requestSyncApi(code, "PUT", { expectedRevision: cloud.revision, progress: merged });
        setSyncStatus("Lernfortschritt synchronisiert.");
        updateDashboard();
        return;
      } catch (error) {
        if (error.status !== 409 || attempt === 3) throw error;
      }
    }
  }

  function requestProgressSync() {
    if (!syncCode || !syncEndpoint()) return Promise.resolve();
    if (syncPromise) {
      syncQueued = true;
      return syncPromise;
    }
    syncPromise = (async () => {
      do {
        syncQueued = false;
        try {
          await synchronizeProgress();
        } catch (error) {
          setSyncStatus(navigator.onLine
            ? "Synchronisierung fehlgeschlagen. Dein Lernfortschritt ist auf diesem Gerät gespeichert."
            : "Offline: Dein Lernfortschritt ist hier gespeichert und wird bei der nächsten Verbindung synchronisiert.");
          if (syncDialogIsOpen()) setSyncMessage(error.message || "Synchronisierung fehlgeschlagen.", true);
          throw error;
        }
      } while (syncQueued);
    })().finally(() => { syncPromise = null; });
    return syncPromise;
  }

  function syncDialogIsOpen() {
    const dialog = $("#sync-dialog");
    return Boolean(dialog.open);
  }

  function scheduleProgressSync() {
    if (!syncCode || !syncEndpoint()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { requestProgressSync().catch(() => {}); }, 450);
  }

  function updateSyncStatus() {
    if (!syncEndpoint()) setSyncStatus("Lernfortschritt wird auf diesem Gerät gespeichert.");
    else if (syncCode) setSyncStatus("Synchronisierungsprofil verbunden.");
    else setSyncStatus("Lernfortschritt wird im Browser gespeichert. Die Synchronisierung muss noch eingerichtet werden.");
    refreshSyncDialog();
  }

  function describeSyncError(error) {
    if (error.status === 404) return "Profil nicht gefunden. Prüfe den Code und versuche es erneut.";
    if (error.status === 409) return "Das Profil wurde auf einem anderen Gerät geändert. Versuche es gleich noch einmal.";
    return error.message || "Verbindung fehlgeschlagen. Deine lokalen Lernstände sind unverändert.";
  }

  async function createSyncFromThisDevice() {
    if (!syncEndpoint()) return;
    const button = $("#sync-create-button");
    button.disabled = true;
    setSyncMessage("Profil mit dem Lernstand dieses Geräts wird erstellt …");
    try {
      let code = localStorage.getItem(SYNC_PENDING_KEY) || makeSyncCode();
      localStorage.setItem(SYNC_PENDING_KEY, code);
      try {
        await requestSyncApi(code, "POST", { progress });
      } catch (error) {
        if (error.status !== 409) throw error;
        // Recover if the server created the profile but the response was lost.
        await requestSyncApi(code, "GET");
      }
      localStorage.setItem(SYNC_CODE_KEY, code);
      localStorage.removeItem(SYNC_PENDING_KEY);
      syncCode = code;
      setSyncMessage("Profil erstellt. Kopiere den Code und gib ihn auf dem anderen Gerät ein.");
      setSyncStatus("Synchronisierungsprofil verbunden.");
      refreshSyncDialog();
      requestProgressSync().catch(() => {});
    } catch (error) {
      setSyncMessage(describeSyncError(error), true);
    } finally {
      button.disabled = false;
    }
  }

  async function joinSyncProfile() {
    if (!syncEndpoint()) return;
    const button = $("#sync-join-button");
    const code = $("#sync-code-input").value.trim();
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(code)) {
      setSyncMessage("Der Code scheint ungültig zu sein. Füge den Code vom anderen Gerät ein.", true);
      return;
    }
    button.disabled = true;
    setSyncMessage("Lernstand wird aus dem Profil geladen …");
    try {
      const cloud = await requestSyncApi(code, "GET");
      try { localStorage.setItem(SYNC_BACKUP_KEY, JSON.stringify(progress)); } catch (_) { /* A backup is best-effort; cloud state remains untouched. */ }
      progress = {
        cards: { ...(cloud.progress.cards || {}) },
        stats: { ...(cloud.progress.stats || defaultState().stats) }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
      localStorage.setItem(SYNC_CODE_KEY, code);
      localStorage.removeItem(SYNC_PENDING_KEY);
      syncCode = code;
      $("#sync-code-input").value = "";
      setSyncMessage("Verbunden. Der bisherige lokale Lernstand auf diesem Gerät wurde ersetzt.");
      setSyncStatus("Synchronisierungsprofil verbunden.");
      refreshSyncDialog();
      updateDashboard();
      beginSession(null, selectedStudyCategory);
      requestProgressSync().catch(() => {});
    } catch (error) {
      setSyncMessage(describeSyncError(error), true);
    } finally {
      button.disabled = false;
    }
  }

  async function copySyncCode() {
    try {
      await navigator.clipboard.writeText(syncCode);
      setSyncMessage("Code kopiert.");
    } catch (_) {
      setSyncMessage("Markiere den Code oben und kopiere ihn.");
    }
  }

  function unlinkSyncDevice() {
    try { localStorage.removeItem(SYNC_CODE_KEY); } catch (_) { /* Local progress remains available. */ }
    syncCode = "";
    setSyncStatus("Lernfortschritt wird auf diesem Gerät gespeichert.");
    setSyncMessage("Gerät getrennt. Deine lokalen Lernstände sind erhalten geblieben.");
    refreshSyncDialog();
  }

  function cardState(id, aspect = "meaning") {
    const key = aspect === "participle" ? `${id}::participle` : id;
    if (!progress.cards[key]) {
      progress.cards[key] = { seen: false, repetitions: 0, interval: 0, ease: 2.5, dueAt: 0, lastReviewed: 0, lapses: 0 };
    }
    return progress.cards[key];
  }

  function studyUnits(words = VOCABULARY) {
    return words.flatMap((word) => [
      { id: word.id, aspect: "meaning" },
      ...(word.participle ? [{ id: word.id, aspect: "participle" }] : [])
    ]);
  }

  function studyCategoryForWord(word) {
    if (word.grammarQuestion) return "grammar";
    return word.category === "Verben" ? "verbs" : "vocabulary";
  }

  function isWordLearned(word) {
    return cardState(word.id).repetitions > 0
      && (!word.participle || cardState(word.id, "participle").repetitions > 0);
  }

  function resetDailyStatsIfNeeded() {
    if (progress.stats.date !== todayKey()) {
      progress.stats.date = todayKey();
      progress.stats.reviewedToday = 0;
      progress.stats.knownToday = 0;
    }
  }

  function interleaveNewAndDue(fresh, due) {
    const queue = [];
    const freshCards = shuffle(fresh);
    let freshIndex = 0;
    let dueIndex = 0;

    while (freshIndex < freshCards.length || dueIndex < due.length) {
      if (freshIndex < freshCards.length) queue.push(freshCards[freshIndex++]);
      if (dueIndex < due.length) queue.push(due[dueIndex++]);
    }
    return queue;
  }

  function availableCount() {
    const now = Date.now();
    return studyUnits().filter((unit) => {
      const state = cardState(unit.id, unit.aspect);
      return !state.seen || state.dueAt <= now;
    }).length;
  }

  function updateDashboard() {
    resetDailyStatsIfNeeded();
    const units = studyUnits();
    const learned = units.filter((unit) => cardState(unit.id, unit.aspect).repetitions > 0).length;
    $("#due-count").textContent = String(availableCount());
    $("#learned-count").textContent = String(learned);
    $("#total-count").textContent = String(units.length);
    updateCategoryProgress(units);
    setDailyNote(vocabularyUpdatedLabel);
  }

  function updateCategoryProgress(units) {
    const wordsById = new Map(VOCABULARY.map((word) => [word.id, word]));
    const groups = { vocabulary: [], verbs: [], grammar: [] };
    for (const unit of units) {
      const word = wordsById.get(unit.id);
      const group = studyCategoryForWord(word);
      groups[group].push(unit);
    }

    for (const [name, categoryUnits] of Object.entries(groups)) {
      const learned = categoryUnits.filter((unit) => cardState(unit.id, unit.aspect).repetitions > 0).length;
      const total = categoryUnits.length;
      const percentage = total ? Math.round((learned / total) * 100) : 0;
      const category = document.querySelector(`[data-progress-category="${name}"]`);
      const track = category.querySelector(".progress-track");
      category.querySelector(".progress-category-count").textContent = `${learned} / ${total}`;
      track.setAttribute("aria-valuemax", String(total));
      track.setAttribute("aria-valuenow", String(learned));
      track.setAttribute("aria-valuetext", `${learned} von ${total} Karten gelernt`);
      track.style.setProperty("--progress-hue", `${Math.round(percentage * 1.2)}deg`);
      const fill = track.querySelector(".progress-fill");
      fill.style.width = `${percentage}%`;
    }
  }

  function setDailyNote(message) { $("#daily-note-text").textContent = message; }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function beginSession(words = null, category = selectedStudyCategory) {
    resetDailyStatsIfNeeded();
    let selected;
    if (words) {
      selected = studyUnits(words);
    } else {
      const categoryWords = category === "random"
        ? VOCABULARY
        : VOCABULARY.filter((word) => studyCategoryForWord(word) === category);
      const units = studyUnits(categoryWords);
      const now = Date.now();
      const due = units.filter((unit) => {
        const state = cardState(unit.id, unit.aspect);
        return state.seen && state.dueAt <= now;
      });
      if (category === "random") shuffle(due);
      else due.sort((a, b) => cardState(a.id, a.aspect).dueAt - cardState(b.id, b.aspect).dueAt);
      const fresh = units.filter((unit) => !cardState(unit.id, unit.aspect).seen);
      selected = interleaveNewAndDue(fresh, due);
    }
    session = { queue: selected.map((unit) => ({ id: unit.id, aspect: unit.aspect, retry: false })), position: 0, revealed: false, retried: new Set(), category };
    updateDashboard();
    renderCurrentCard();
  }

  function renderCurrentCard() {
    const item = session?.queue[session.position];
    const word = item && VOCABULARY.find((entry) => entry.id === item.id);
    const hasCard = Boolean(word);
    const isParticiple = item?.aspect === "participle";
    $("#empty-state").hidden = hasCard;
    $("#card-meta").hidden = !hasCard;
    $("#flashcard").hidden = !hasCard;
    $("#answer-prompt").hidden = true;
    if (!hasCard) {
      const categoryNames = { vocabulary: "den Wortschatz", verbs: "die Verben", grammar: "die Grammatik", random: "alle Bereiche" };
      const categoryName = categoryNames[session.category];
      const scopedWords = session.category === "random"
        ? VOCABULARY
        : VOCABULARY.filter((entry) => studyCategoryForWord(entry) === session.category);
      const nextDue = studyUnits(scopedWords).map((unit) => cardState(unit.id, unit.aspect).dueAt)
        .filter((at) => at > Date.now()).sort((a, b) => a - b)[0];
      $("#empty-title").textContent = nextDue
        ? "Zurzeit sind keine Karten verfügbar."
        : session.category === "random" ? "Alle Karten erledigt." : "Bereich abgeschlossen.";
      $("#empty-message").textContent = nextDue
        ? `Für ${categoryName} sind keine Karten mehr verfügbar. Die nächsten Wiederholungen kommen später.`
        : session.category === "random"
          ? "Du hast alle verfügbaren Karten erledigt. Du kannst sie trotzdem wiederholen oder den Wortschatz ansehen."
          : `Du kannst einen anderen Bereich wählen oder ${categoryName} trotzdem wiederholen.`;
      return;
    }
    session.revealed = false;
    const isGrammar = Boolean(word.grammarQuestion);
    $("#card-category").textContent = word.category.toUpperCase();
    $("#card-counter").textContent = `${session.position + 1} / ${session.queue.length} in der Wiederholung`;
    $("#card-front-direction").textContent = isParticiple
      ? "WIE LAUTET DAS ITALIENISCHE PARTIZIP PERFEKT VON?"
      : isGrammar ? word.grammarInstruction : "WIE HEISST DAS AUF ITALIENISCH?";
    $("#card-question-word").textContent = isParticiple ? word.participlePrompt : isGrammar ? word.grammarPrompt : word.it;
    $("#card-question-word").classList.toggle("grammar-question", isGrammar);
    $("#card-hint").textContent = isParticiple
      ? "Überlege dir die Form und tippe dann auf die Karte"
      : "Überlege kurz und tippe dann auf die Karte";
    $("#card-back-direction").textContent = isParticiple
      ? "PARTIZIP PERFEKT"
      : isGrammar ? "ANTWORT" : "AUF ITALIENISCH";
    $("#card-italian").textContent = isParticiple ? word.participle : isGrammar ? word.grammarAnswer : word.de;
    $("#card-extra").textContent = isGrammar
      ? word.grammarExplanation
      : !isParticiple && word.plural ? `Plural: ${word.plural}` : "";
    $("#card-extra").hidden = !$("#card-extra").textContent;
    $("#card-face").hidden = false;
    $("#card-back").hidden = true;
    $("#flashcard").setAttribute("aria-label", isParticiple
      ? `Zeige das Partizip Perfekt von ${word.participlePrompt}`
      : isGrammar ? `Beantworte die Grammatikfrage: ${word.grammarPrompt}` : `Zeige die Übersetzung von: ${word.it}`);
    $("#card-back").setAttribute("aria-label", isParticiple
      ? `Partizip Perfekt: ${word.participle}`
      : isGrammar ? `Antwort: ${word.grammarAnswer}` : `Übersetzung: ${word.de}`);
    $("#flashcard").focus({ preventScroll: true });
  }

  function revealCard() {
    if (!session || session.revealed || !session.queue[session.position]) return;
    session.revealed = true;
    $("#card-face").hidden = true;
    $("#card-back").hidden = false;
    $("#answer-prompt").hidden = false;
    const item = session.queue[session.position];
    const word = VOCABULARY.find((entry) => entry.id === item.id);
    $("#flashcard").setAttribute("aria-label", word?.grammarQuestion ? "Grammatikantwort angezeigt" : "Übersetzung angezeigt");
    $("#yes-button").focus({ preventScroll: true });
  }

  function recordAnswer(remembered) {
    const item = session?.queue[session.position];
    if (!item || !session.revealed) return;
    const now = Date.now();
    const state = cardState(item.id, item.aspect);
    if (!state.seen) {
      state.seen = true;
    }
    state.lastReviewed = now;
    progress.stats.reviewedToday += 1;
    if (remembered) {
      state.interval = state.repetitions === 0 ? 1 : state.repetitions === 1 ? 3 : Math.max(1, Math.round(state.interval * state.ease));
      state.repetitions += 1;
      state.ease = Math.min(3, state.ease + 0.1);
      state.dueAt = now + state.interval * DAY;
      progress.stats.knownToday += 1;
    } else {
      state.repetitions = 0;
      state.interval = 0;
      state.ease = Math.max(1.3, state.ease - 0.2);
      state.lapses += 1;
      state.dueAt = now + 10 * MINUTE;
      const retryKey = `${item.id}:${item.aspect}`;
      if (!item.retry && !session.retried.has(retryKey)) {
        session.retried.add(retryKey);
        session.queue.push({ id: item.id, aspect: item.aspect, retry: true });
      }
    }
    session.position += 1;
    saveProgress();
    scheduleProgressSync();
    updateDashboard();
    renderCurrentCard();
  }

  function showVocabulary() {
    $("#review-view").hidden = true;
    $("#vocabulary-view").hidden = false;
    $("#search-input").value = "";
    selectedCategory = "Alle";
    renderFilters();
    renderVocabulary();
    window.scrollTo(0, 0);
    $("#search-input").focus({ preventScroll: true });
  }

  function showReview() {
    $("#vocabulary-view").hidden = true;
    $("#review-view").hidden = false;
    window.scrollTo(0, 0);
    updateDashboard();
  }

  function renderFilters() {
    const categories = ["Alle", ...new Set(VOCABULARY.map((word) => word.category))];
    $("#category-filters").innerHTML = categories.map((category) =>
      `<button class="filter-chip${category === selectedCategory ? " selected" : ""}" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
    ).join("");
  }

  function renderVocabulary() {
    const query = $("#search-input").value.trim().toLocaleLowerCase("de");
    const matches = VOCABULARY.filter((word) => (selectedCategory === "Alle" || word.category === selectedCategory)
      && (!query || `${word.it} ${word.de} ${word.plural} ${word.category}`.toLocaleLowerCase("de").includes(query)));
    $("#vocab-result-count").textContent = `${matches.length} ${matches.length === 1 ? "Eintrag" : "Einträge"}`;
    if (!matches.length) {
      $("#vocab-list").innerHTML = '<div class="no-results">Keine passenden Einträge gefunden.</div>';
      return;
    }
    $("#vocab-list").innerHTML = matches.map((word) => {
      const learned = isWordLearned(word);
      const answer = word.grammarQuestion ? word.grammarAnswer : word.de;
      return `<div class="vocab-row${word.grammarQuestion ? " grammar-vocab-row" : ""}"><span class="vocab-source">${escapeHtml(word.it)}</span><span class="vocab-target">${escapeHtml(answer)}</span><span class="vocab-status${learned ? " learned" : ""}" aria-hidden="true"></span></div>`;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function setSelectedStudyCategory(category) {
    selectedStudyCategory = category;
    document.querySelectorAll("[data-study-category]").forEach((button) => {
      const selected = button.dataset.studyCategory === category;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function practiceAll() {
    const words = selectedStudyCategory === "random"
      ? VOCABULARY
      : VOCABULARY.filter((word) => studyCategoryForWord(word) === selectedStudyCategory);
    beginSession(shuffle(words), selectedStudyCategory);
  }

  function playAnswerSound(correct) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      if (!feedbackAudioContext) feedbackAudioContext = new AudioContextClass();
      const context = feedbackAudioContext;
      const playNotes = () => {
        if (context.state !== "running") return;
        const notes = correct ? [659.25, 880] : [330, 246.94];
        notes.forEach((frequency, index) => {
          const start = context.currentTime + index * 0.11;
          const oscillator = context.createOscillator();
          const volume = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, start);
          volume.gain.setValueAtTime(0.0001, start);
          volume.gain.exponentialRampToValueAtTime(0.14, start + 0.012);
          volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
          oscillator.connect(volume);
          volume.connect(context.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.13);
        });
      };

      if (context.state === "suspended") context.resume().then(playNotes).catch(() => {});
      else playNotes();
    } catch (_) { /* Audio feedback is optional; answering must always work. */ }
  }

  const [year, month, day] = VOCABULARY_UPDATED_AT.split("-").map(Number);
  const vocabDate = new Date(year, month - 1, day, 12);
  const formattedVocabDate = new Intl.DateTimeFormat("de-DE", {
    day: "numeric", month: "long", year: "numeric"
  }).format(vocabDate);
  const vocabularyUpdatedLabel = `Stand: ${formattedVocabDate} · Niveau ${VOCABULARY_UPDATED_LESSON}`;

  $("#flashcard").addEventListener("click", revealCard);
  $("#no-button").addEventListener("click", () => {
    playAnswerSound(false);
    recordAnswer(false);
  });
  $("#yes-button").addEventListener("click", () => {
    playAnswerSound(true);
    recordAnswer(true);
  });
  $("#practice-all-button").addEventListener("click", practiceAll);
  $("#study-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-study-category]");
    if (!button) return;
    const category = button.dataset.studyCategory;
    setSelectedStudyCategory(category);
    beginSession(null, category);
  });
  $("#browse-link").addEventListener("click", showVocabulary);
  $("#back-to-review").addEventListener("click", showReview);
  const syncDialog = $("#sync-dialog");
  $("#sync-settings-button").addEventListener("click", () => {
    refreshSyncDialog();
    syncDialog.showModal();
  });
  $("#close-sync-dialog").addEventListener("click", () => syncDialog.close());
  syncDialog.addEventListener("click", (event) => {
    if (event.target === syncDialog) syncDialog.close();
  });
  $("#sync-create-button").addEventListener("click", createSyncFromThisDevice);
  $("#sync-join-button").addEventListener("click", joinSyncProfile);
  $("#sync-copy-button").addEventListener("click", copySyncCode);
  $("#sync-now-button").addEventListener("click", () => requestProgressSync().catch((error) => setSyncMessage(describeSyncError(error), true)));
  $("#sync-unlink-button").addEventListener("click", unlinkSyncDevice);
  $("#search-input").addEventListener("input", renderVocabulary);
  $("#category-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    selectedCategory = button.dataset.category;
    renderFilters();
    renderVocabulary();
  });
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isIos && !isStandalone) {
    $("#install-button").hidden = false;
    $("#install-button").textContent = "Installationshilfe";
    const installHelpDialog = $("#install-help-dialog");
    $("#install-button").addEventListener("click", () => {
      if (typeof installHelpDialog.showModal === "function") installHelpDialog.showModal();
      else window.alert("Tippe in Safari auf „Teilen“, wähle „Zum Home-Bildschirm“ und tippe auf „Hinzufügen“.");
    });
    $("#close-install-help").addEventListener("click", () => installHelpDialog.close());
    installHelpDialog.addEventListener("click", (event) => {
      if (event.target === installHelpDialog) installHelpDialog.close();
    });
  } else {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      $("#install-button").hidden = false;
    });
    $("#install-button").addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $("#install-button").hidden = true;
    });
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    let serviceWorkerRegistration = null;
    let reloadedForUpdate = false;
    const alreadyControlled = Boolean(navigator.serviceWorker.controller);

    if (alreadyControlled) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloadedForUpdate) return;
        reloadedForUpdate = true;
        window.location.reload();
      });
    }

    async function checkForServiceWorkerUpdate() {
      try {
        serviceWorkerRegistration = serviceWorkerRegistration || await navigator.serviceWorker.getRegistration();
        if (serviceWorkerRegistration) await serviceWorkerRegistration.update();
      } catch (_) { /* Update checks can fail offline; the cached app remains available. */ }
    }

    window.addEventListener("load", async () => {
      try {
        serviceWorkerRegistration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
        await serviceWorkerRegistration.update();
      } catch (_) { /* The app still works online if service workers are unavailable. */ }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForServiceWorkerUpdate();
    });
  }
  window.addEventListener("online", () => requestProgressSync().catch(() => {}));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestProgressSync().catch(() => {});
  });
  updateSyncStatus();
  updateDashboard();
  setSelectedStudyCategory("random");
  beginSession(null, "random");
  if (syncCode && syncEndpoint()) requestProgressSync().catch(() => {});
})();
