const SESSION_KEY = "lab_paper_tracker_session_uid";
const POLL_INTERVAL_MS = 10000;

const authPanel = document.getElementById("authPanel");
const appPanel = document.getElementById("appPanel");
const joinForm = document.getElementById("joinForm");
const joinName = document.getElementById("joinName");
const joinEmail = document.getElementById("joinEmail");
const joinBtn = document.getElementById("joinBtn");
const knownMembers = document.getElementById("knownMembers");
const userChip = document.getElementById("userChip");
const authError = document.getElementById("authError");
const appError = document.getElementById("appError");
const logoutBtn = document.getElementById("logoutBtn");
const leaveBtn = document.getElementById("leaveBtn");

const paperForm = document.getElementById("paperForm");
const clearPaperBtn = document.getElementById("clearPaperBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const paperFormMode = document.getElementById("paperFormMode");
const paperSubmitBtn = document.getElementById("paperSubmitBtn");

const objectiveForm = document.getElementById("objectiveForm");
const objectiveSubmitBtn = document.getElementById("objectiveSubmitBtn");
const objectiveStatus = document.getElementById("objectiveStatus");
const objectiveBadge = document.getElementById("objectiveBadge");
const objectiveProgressBar = document.getElementById("objectiveProgressBar");
const objectiveCountdown = document.getElementById("objectiveCountdown");
const objectiveLockedCard = document.getElementById("objectiveLockedCard");
const objectiveLockNote = document.getElementById("objectiveLockNote");
const objectivePageCountdown = document.getElementById("objectivePageCountdown");

const leaderboardBody = document.getElementById("leaderboardBody");
const papersBody = document.getElementById("papersBody");
const showAllPapersBtn = document.getElementById("showAllPapersBtn");
const showMyPapersBtn = document.getElementById("showMyPapersBtn");
const paperSearch = document.getElementById("paperSearch");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfo = document.getElementById("pageInfo");

const closeProfileBtn = document.getElementById("closeProfileBtn");
const profileContent = document.getElementById("profileContent");

const statPapers = document.getElementById("statPapers");
const statTotalTime = document.getElementById("statTotalTime");
const statAvgTime = document.getElementById("statAvgTime");
const teamMembersStat = document.getElementById("teamMembersStat");
const teamPapersStat = document.getElementById("teamPapersStat");
const teamMinutesStat = document.getElementById("teamMinutesStat");
const activeReadersStat = document.getElementById("activeReadersStat");
const activityList = document.getElementById("activityList");
const topReadersList = document.getElementById("topReadersList");

const navItems = [...document.querySelectorAll(".nav-item")];
const pages = [...document.querySelectorAll(".page")];

let usersCache = [];
let papersCache = [];
let objectivesByUid = {};
let currentUser = null;
let objectiveCache = null;

let trendChart = null;
let activePage = "dashboardPage";
let selectedProfileUid = null;
let editingPaperId = null;
let paperListMode = "all";
let paperSearchQuery = "";
let paperPage = 1;

let objectiveTickerId = null;
let pollerId = null;
let syncInProgress = false;

const papersPerPage = 10;

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();

  const displayName = joinName.value.trim();
  const email = joinEmail.value.trim().toLowerCase();

  if (!displayName) {
    showErrorText("Please enter your name.");
    return;
  }
  if (!isValidEmail(email)) {
    showErrorText("Please enter a valid email address.");
    return;
  }

  joinBtn.disabled = true;
  joinBtn.textContent = "Joining...";
  try {
    const result = await apiFetch("/api/join", {
      method: "POST",
      body: { displayName, email },
    });
    if (!result?.user?.uid) {
      throw new Error("Join response is invalid.");
    }
    setSessionUid(result.user.uid);
    joinForm.reset();
    selectedProfileUid = null;
    await refreshFromServer({ preservePage: false });
  } catch (error) {
    showErrorText(`Join failed: ${error.message}`);
  } finally {
    joinBtn.disabled = false;
    joinBtn.textContent = "Join Workspace";
  }
});

logoutBtn.addEventListener("click", async () => {
  setSessionUid(null);
  selectedProfileUid = null;
  showSignedOutView();
  await refreshFromServer({ preservePage: false, silent: true });
});

leaveBtn.addEventListener("click", async () => {
  if (!currentUser) return;
  const confirmed = confirm(
    "Leave workspace and delete your profile/objective and all your papers for all members?"
  );
  if (!confirmed) return;

  const uid = currentUser.uid;
  const oldLabel = leaveBtn.textContent;
  leaveBtn.disabled = true;
  leaveBtn.textContent = "Leaving...";

  setSessionUid(null);
  showSignedOutView();

  try {
    await apiFetch(`/api/users/${encodeURIComponent(uid)}`, {
      method: "DELETE",
      body: { requestUid: uid },
    });
  } catch (error) {
    showErrorText(`Leave failed: ${error.message}`);
  } finally {
    leaveBtn.disabled = false;
    leaveBtn.textContent = oldLabel;
    await refreshFromServer({ preservePage: false, silent: true });
  }
});

showAllPapersBtn.addEventListener("click", () => {
  paperListMode = "all";
  paperPage = 1;
  renderPapersList();
});

showMyPapersBtn.addEventListener("click", () => {
  paperListMode = "mine";
  paperPage = 1;
  renderPapersList();
});

paperSearch.addEventListener("input", () => {
  paperSearchQuery = paperSearch.value.trim().toLowerCase();
  paperPage = 1;
  renderPapersList();
});

prevPageBtn.addEventListener("click", () => {
  paperPage = Math.max(1, paperPage - 1);
  renderPapersList();
});

nextPageBtn.addEventListener("click", () => {
  paperPage += 1;
  renderPapersList();
});

clearPaperBtn.addEventListener("click", () => {
  resetPaperFormMode();
});

cancelEditBtn.addEventListener("click", () => {
  resetPaperFormMode();
});

closeProfileBtn.addEventListener("click", () => {
  selectedProfileUid = null;
  setProfileInUrl(null);
  navigateTo("leaderboardPage", true);
  renderSelectedProfile();
});

for (const nav of navItems) {
  nav.addEventListener("click", () => {
    const page = nav.dataset.page;
    if (!page || nav.classList.contains("locked")) return;
    navigateTo(page, true);
  });
}

window.addEventListener("popstate", () => {
  selectedProfileUid = getProfileFromUrl();
  if (selectedProfileUid) {
    navigateTo("profilePage", false);
  }
  renderSelectedProfile();
});

paperForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;

  if (!objectiveCache) {
    showErrorText("Set your one-time objective first.");
    navigateTo("objectivePage", true);
    return;
  }

  const paperTitle = document.getElementById("paperTitle").value.trim();
  const paperUrl = document.getElementById("paperUrl").value.trim();
  const readingMinutes = Number(document.getElementById("paperTime").value);
  const memoUrl = document.getElementById("memoUrl").value.trim();

  if (!paperTitle || !isWebUrl(paperUrl) || !isWebUrl(memoUrl) || !Number.isFinite(readingMinutes) || readingMinutes <= 0) {
    showErrorText("Please fill valid paper title/URL/memo URL/reading time.");
    return;
  }

  paperSubmitBtn.disabled = true;
  paperSubmitBtn.textContent = editingPaperId ? "Updating..." : "Saving...";

  try {
    if (editingPaperId) {
      await apiFetch(`/api/papers/${encodeURIComponent(editingPaperId)}`, {
        method: "PUT",
        body: {
          uid: currentUser.uid,
          paperTitle,
          paperUrl,
          memoUrl,
          readingMinutes,
        },
      });
    } else {
      await apiFetch("/api/papers", {
        method: "POST",
        body: {
          uid: currentUser.uid,
          paperTitle,
          paperUrl,
          memoUrl,
          readingMinutes,
        },
      });
    }

    resetPaperFormMode();
    clearErrors();
    await refreshFromServer({ preservePage: true, silent: true });
  } catch (error) {
    showErrorText(`Could not save paper: ${error.message}`);
  } finally {
    paperSubmitBtn.disabled = false;
    paperSubmitBtn.textContent = "Save Record";
    if (editingPaperId) {
      paperSubmitBtn.textContent = "Update Record";
    }
  }
});

objectiveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;

  if (objectiveCache) {
    showErrorText("Objective is already set and cannot be changed.");
    return;
  }

  const targetPapers = Number(document.getElementById("targetPapers").value);
  const startDate = document.getElementById("startDate").value;
  const endDate = document.getElementById("endDate").value;

  if (!Number.isFinite(targetPapers) || targetPapers < 1) {
    showErrorText("Target papers must be 1 or more.");
    return;
  }

  if (!startDate || !endDate || new Date(startDate) > new Date(endDate)) {
    showErrorText("Start date must be before end date.");
    return;
  }

  objectiveSubmitBtn.disabled = true;
  objectiveSubmitBtn.textContent = "Saving...";

  try {
    await apiFetch("/api/objectives", {
      method: "POST",
      body: {
        uid: currentUser.uid,
        targetPapers,
        startDate,
        endDate,
      },
    });
    clearErrors();
    await refreshFromServer({ preservePage: true, silent: true });
    navigateTo("dashboardPage", true);
  } catch (error) {
    showErrorText(`Could not save objective: ${error.message}`);
  } finally {
    objectiveSubmitBtn.disabled = false;
    objectiveSubmitBtn.textContent = "Save Objective";
  }
});

async function init() {
  selectedProfileUid = getProfileFromUrl();
  renderKnownMembers();
  await refreshFromServer({ preservePage: false, silent: true });
  startPolling();
}

async function refreshFromServer({ preservePage = true, silent = false } = {}) {
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    const state = await apiFetch("/api/state");
    usersCache = Array.isArray(state?.users) ? state.users : [];
    papersCache = Array.isArray(state?.papers) ? state.papers : [];
    objectivesByUid = state?.objectives && typeof state.objectives === "object" ? state.objectives : {};

    const sessionUid = getSessionUid();
    currentUser = sessionUid ? usersCache.find((u) => u.uid === sessionUid) || null : null;
    objectiveCache = currentUser ? objectivesByUid[currentUser.uid] || null : null;

    renderKnownMembers();

    if (!currentUser) {
      showSignedOutView();
      return;
    }

    showSignedInShell();
    renderMyStats();
    renderObjectiveViews();
    renderCollaborationSnapshot();
    renderLeaderboard();
    renderPapersList();
    renderSelectedProfile();

    if (selectedProfileUid) {
      navigateTo("profilePage", false);
    } else if (preservePage) {
      navigateTo(activePage, false);
    } else {
      navigateTo("dashboardPage", false);
    }

    enforceObjectiveRequirement();
    clearErrors();
  } catch (error) {
    if (!silent) {
      showErrorText(`Sync failed: ${error.message}`);
    }
  } finally {
    syncInProgress = false;
  }
}

function showSignedInShell() {
  authPanel.classList.add("hidden");
  appPanel.classList.remove("hidden");
  userChip.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  leaveBtn.classList.remove("hidden");
  userChip.textContent = `${currentUser.displayName || currentUser.email || "Unknown"}`;
}

function showSignedOutView() {
  currentUser = null;
  objectiveCache = null;
  stopObjectiveTicker();
  setSessionUid(null);

  authPanel.classList.remove("hidden");
  appPanel.classList.add("hidden");
  userChip.classList.add("hidden");
  logoutBtn.classList.add("hidden");
  leaveBtn.classList.add("hidden");
  userChip.textContent = "";

  joinBtn.disabled = false;
  resetPaperFormMode();
}

function navigateTo(pageId, fromUserAction = true) {
  let targetPage = pageId;
  if (!objectiveCache && targetPage !== "objectivePage") {
    targetPage = "objectivePage";
  }

  activePage = targetPage;

  for (const page of pages) {
    page.classList.toggle("hidden", page.id !== targetPage);
  }

  for (const nav of navItems) {
    const isActive = nav.dataset.page === targetPage;
    nav.classList.toggle("active", isActive);
    const shouldLock = !objectiveCache && nav.dataset.page !== "objectivePage";
    nav.classList.toggle("locked", shouldLock);
  }

  if (targetPage !== "profilePage") {
    if (fromUserAction) selectedProfileUid = null;
    setProfileInUrl(null);
  }
}

function enforceObjectiveRequirement() {
  for (const nav of navItems) {
    const shouldLock = !objectiveCache && nav.dataset.page !== "objectivePage";
    nav.classList.toggle("locked", shouldLock);
  }
}

function renderKnownMembers() {
  if (!usersCache.length) {
    knownMembers.classList.add("hidden");
    knownMembers.innerHTML = "";
    return;
  }

  const sorted = [...usersCache].sort((a, b) =>
    String(a.displayName || a.email || "").localeCompare(String(b.displayName || b.email || ""))
  );

  knownMembers.classList.remove("hidden");
  knownMembers.innerHTML = `
    <strong>Quick Continue</strong>
    <div class="known-member-list">
      ${sorted
        .map(
          (u) =>
            `<button type="button" data-quick-user="${escapeHtml(u.uid)}">Continue as ${escapeHtml(
              u.displayName || u.email || "Unknown"
            )}</button>`
        )
        .join("")}
    </div>
  `;

  knownMembers.querySelectorAll("[data-quick-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.getAttribute("data-quick-user");
      setSessionUid(uid);
      selectedProfileUid = null;
      await refreshFromServer({ preservePage: false });
    });
  });
}

function renderMyStats() {
  if (!currentUser) return;

  const myPapers = papersCache.filter((p) => p.uid === currentUser.uid);
  const totalPapers = myPapers.length;
  const totalMinutes = myPapers.reduce((sum, p) => sum + (Number(p.readingMinutes) || 0), 0);
  const avgMinutes = totalPapers ? Math.round(totalMinutes / totalPapers) : 0;

  statPapers.textContent = `${totalPapers}`;
  statTotalTime.textContent = `${totalMinutes} min`;
  statAvgTime.textContent = `${avgMinutes} min`;

  renderTrendChart(myPapers);
}

function renderCollaborationSnapshot() {
  const totalMembers = usersCache.length;
  const totalPapers = papersCache.length;
  const totalMinutes = papersCache.reduce((sum, p) => sum + (Number(p.readingMinutes) || 0), 0);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const activeReaders = new Set(
    papersCache.filter((p) => new Date(p.readAt || 0).getTime() >= sevenDaysAgo).map((p) => p.uid)
  ).size;

  teamMembersStat.textContent = `${totalMembers}`;
  teamPapersStat.textContent = `${totalPapers}`;
  teamMinutesStat.textContent = `${totalMinutes} min`;
  activeReadersStat.textContent = `${activeReaders}`;

  const recent = [...papersCache]
    .sort((a, b) => new Date(b.readAt || 0) - new Date(a.readAt || 0))
    .slice(0, 8);

  activityList.innerHTML = recent.length
    ? recent
        .map((paper) => {
          const name = paper.userName || resolveUserName(paper.uid) || "Unknown";
          const title = paper.paperTitle || "(No title)";
          const mins = Number(paper.readingMinutes) || 0;
          return `<li><strong>${escapeHtml(name)}</strong> read <em>${escapeHtml(
            title
          )}</em> (${mins} min) · ${escapeHtml(relativeTime(paper.readAt))}</li>`;
        })
        .join("")
    : "<li>No activity yet. Add your first paper record.</li>";

  const since30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rankMap = new Map();
  for (const p of papersCache) {
    if (new Date(p.readAt || 0).getTime() < since30d) continue;
    const curr = rankMap.get(p.uid) || {
      uid: p.uid,
      name: p.userName || resolveUserName(p.uid) || "Unknown",
      count: 0,
    };
    curr.count += 1;
    rankMap.set(p.uid, curr);
  }

  const ranking = [...rankMap.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  topReadersList.innerHTML = ranking.length
    ? ranking
        .map(
          (r, i) =>
            `<li>#${i + 1} <button class="link-btn" data-open-profile="${escapeHtml(r.uid)}">${escapeHtml(
              r.name
            )}</button> · ${r.count} papers</li>`
        )
        .join("")
    : "<li>No papers in the last 30 days.</li>";

  topReadersList.querySelectorAll("[data-open-profile]").forEach((btn) => {
    btn.addEventListener("click", () => openProfile(btn.getAttribute("data-open-profile")));
  });
}

function renderTrendChart(myPapers) {
  const weeks = getPastWeeks(8);
  const weeklyCounts = weeks.map((week) =>
    myPapers.filter((p) => {
      const d = new Date(p.readAt);
      return d >= week.start && d <= week.end;
    }).length
  );

  const labels = weeks.map((w) => w.label);

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById("trendChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Papers per Week",
          data: weeklyCounts,
          fill: true,
          tension: 0.35,
          borderColor: "#146c43",
          backgroundColor: "rgba(20,108,67,0.14)",
          pointBackgroundColor: "#146c43",
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderObjectiveViews() {
  const myPapers = papersCache.filter((p) => p.uid === currentUser?.uid);
  const paperCount = myPapers.length;

  if (!objectiveCache) {
    objectiveStatus.textContent = "No objective set yet.";
    objectiveBadge.textContent = "Not set";
    objectiveProgressBar.style.width = "0%";
    objectiveCountdown.textContent = "No objective countdown yet.";
    objectivePageCountdown.classList.add("hidden");
    objectivePageCountdown.textContent = "";
    objectiveForm.classList.remove("hidden");
    objectiveSubmitBtn.disabled = false;
    objectiveLockNote.textContent = "Set your objective once. It cannot be changed later.";
    objectiveLockedCard.classList.add("hidden");
    objectiveLockedCard.innerHTML = "";
    stopObjectiveTicker();
    return;
  }

  const { targetPapers, startDate, endDate } = objectiveCache;
  const progress = targetPapers > 0 ? Math.min(100, Math.round((paperCount / targetPapers) * 100)) : 0;
  const remaining = Math.max(0, targetPapers - paperCount);
  const startPretty = formatDateLong(startDate);
  const endPretty = formatDateLong(endDate);

  objectiveStatus.innerHTML = `
    <strong>📘 ${paperCount}/${targetPapers} papers completed (${progress}%)</strong><br>
    Remaining papers: <strong>${remaining}</strong><br>
    Duration: ${startPretty} - ${endPretty}
  `;
  objectiveBadge.textContent = `${progress}%`;
  objectiveProgressBar.style.width = `${progress}%`;

  objectiveForm.classList.add("hidden");
  objectiveSubmitBtn.disabled = true;
  objectiveLockNote.textContent = "Objective is locked after first submission.";
  objectiveLockedCard.classList.remove("hidden");
  objectiveLockedCard.innerHTML = `
    <p class="objective-lock-title">🔒 Objective Locked</p>
    <div class="objective-meta">
      <div class="objective-chip">🎯 Target: ${targetPapers} papers</div>
      <div class="objective-chip">📈 Progress: ${paperCount}/${targetPapers} (${progress}%)</div>
      <div class="objective-chip">🗓️ Start: ${startPretty}</div>
      <div class="objective-chip">🏁 End: ${endPretty}</div>
    </div>
    <p id="objectiveLockCountdown" class="objective-countdown"></p>
  `;

  updateObjectiveCountdown();
  startObjectiveTicker();
}

function renderLeaderboard() {
  const byUser = new Map();

  for (const user of usersCache) {
    byUser.set(user.uid, {
      uid: user.uid,
      name: user.displayName || user.email || "Unknown",
      count: 0,
      minutes: 0,
      trend: 0,
    });
  }

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

  for (const paper of papersCache) {
    if (!byUser.has(paper.uid)) {
      byUser.set(paper.uid, {
        uid: paper.uid,
        name: paper.userName || "Unknown",
        count: 0,
        minutes: 0,
        trend: 0,
      });
    }

    const item = byUser.get(paper.uid);
    item.count += 1;
    item.minutes += Number(paper.readingMinutes) || 0;

    const ts = new Date(paper.readAt).getTime();
    if (now - ts <= sevenDaysMs) item.trend += 1;
    if (now - ts > sevenDaysMs && now - ts <= fourteenDaysMs) item.trend -= 1;
  }

  const ranking = [...byUser.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes);

  leaderboardBody.innerHTML = ranking
    .map((r, i) => {
      const trendClass = r.trend > 0 ? "trend-up" : r.trend < 0 ? "trend-down" : "trend-flat";
      const trendText = r.trend > 0 ? `+${r.trend}` : `${r.trend}`;
      return `
      <tr>
        <td>${i + 1}</td>
        <td><button class="link-btn" data-open-profile="${escapeHtml(r.uid)}">${escapeHtml(r.name)}</button></td>
        <td>${r.count}</td>
        <td>${r.minutes} min</td>
        <td class="${trendClass}">${trendText}</td>
      </tr>`;
    })
    .join("");

  leaderboardBody.querySelectorAll("[data-open-profile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openProfile(btn.getAttribute("data-open-profile"));
    });
  });
}

function renderPapersList() {
  const sorted = [...papersCache].sort((a, b) => {
    const ta = new Date(a.readAt || 0).getTime();
    const tb = new Date(b.readAt || 0).getTime();
    return tb - ta;
  });

  const rows =
    paperListMode === "mine" && currentUser
      ? sorted.filter((p) => p.uid === currentUser.uid)
      : sorted;

  const searched = rows.filter((paper) => {
    if (!paperSearchQuery) return true;
    const reader = (paper.userName || resolveUserName(paper.uid) || "").toLowerCase();
    const title = String(paper.paperTitle || "").toLowerCase();
    return reader.includes(paperSearchQuery) || title.includes(paperSearchQuery);
  });

  const totalPages = Math.max(1, Math.ceil(searched.length / papersPerPage));
  paperPage = Math.min(paperPage, totalPages);
  const start = (paperPage - 1) * papersPerPage;
  const paginated = searched.slice(start, start + papersPerPage);

  papersBody.innerHTML = paginated
    .map((paper) => {
      const isMine = paper.uid === currentUser?.uid;
      const reader = paper.userName || resolveUserName(paper.uid) || "Unknown";
      const readerCell = `<button class="link-btn" data-open-profile="${escapeHtml(paper.uid)}">${escapeHtml(
        reader
      )}</button>`;
      const title = paper.paperTitle || "(No title)";
      const paperLink = isWebUrl(paper.paperUrl)
        ? `<a href="${paper.paperUrl}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>`
        : escapeHtml(title);
      const memoLink = isWebUrl(paper.memoUrl)
        ? `<a href="${paper.memoUrl}" target="_blank" rel="noreferrer">Open memo</a>`
        : "-";

      const actionCell = isMine
        ? `
        <div class="row-actions">
          <button class="btn btn-small btn-secondary" data-edit-paper="${paper.id}">Edit</button>
          <button class="btn btn-small btn-danger" data-delete-paper="${paper.id}">Delete</button>
        </div>`
        : "-";

      return `
      <tr>
        <td>${formatDate(paper.readAt)}</td>
        <td>${readerCell}</td>
        <td>${paperLink}</td>
        <td>${Number(paper.readingMinutes) || 0} min</td>
        <td>${memoLink}</td>
        <td>${actionCell}</td>
      </tr>`;
    })
    .join("");

  if (!paginated.length) {
    papersBody.innerHTML = `<tr><td colspan="6">No records found.</td></tr>`;
  }

  papersBody.querySelectorAll("[data-delete-paper]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-delete-paper");
      const confirmed = confirm("Delete this paper record?");
      if (!confirmed || !currentUser) return;
      try {
        await apiFetch(`/api/papers/${encodeURIComponent(id)}`, {
          method: "DELETE",
          body: { uid: currentUser.uid },
        });
        await refreshFromServer({ preservePage: true, silent: true });
      } catch (error) {
        showErrorText(`Delete failed: ${error.message}`);
      }
    });
  });

  papersBody.querySelectorAll("[data-edit-paper]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit-paper");
      const paper = papersCache.find((p) => p.id === id);
      if (!paper || paper.uid !== currentUser?.uid) return;
      editingPaperId = paper.id;
      document.getElementById("paperTitle").value = paper.paperTitle || "";
      document.getElementById("paperUrl").value = paper.paperUrl || "";
      document.getElementById("paperTime").value = Number(paper.readingMinutes) || 1;
      document.getElementById("memoUrl").value = paper.memoUrl || "";
      paperFormMode.classList.remove("hidden");
      paperSubmitBtn.textContent = "Update Record";
      cancelEditBtn.classList.remove("hidden");
      navigateTo("addPaperPage", true);
      paperForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  papersBody.querySelectorAll("[data-open-profile]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openProfile(btn.getAttribute("data-open-profile"));
    });
  });

  pageInfo.textContent = `Page ${paperPage} / ${totalPages}`;
  prevPageBtn.disabled = paperPage <= 1;
  nextPageBtn.disabled = paperPage >= totalPages;
}

function renderSelectedProfile() {
  if (!selectedProfileUid) {
    profileContent.innerHTML = `<p class="subtext">Select a member from leaderboard or paper records.</p>`;
    return;
  }

  const member = usersCache.find((u) => u.uid === selectedProfileUid);
  const name = member?.displayName || member?.email || "Unknown";
  const userPapers = papersCache.filter((p) => p.uid === selectedProfileUid);
  const count = userPapers.length;
  const totalMin = userPapers.reduce((s, p) => s + (Number(p.readingMinutes) || 0), 0);
  const avgMin = count ? Math.round(totalMin / count) : 0;
  const recent = [...userPapers]
    .sort((a, b) => new Date(b.readAt || 0) - new Date(a.readAt || 0))
    .slice(0, 10);

  profileContent.innerHTML = `
    <h3>${escapeHtml(name)}</h3>
    <p class="subtext">${escapeHtml(member?.email || "")}</p>
    <div class="profile-grid">
      <article class="stat-card"><p>Papers</p><strong>${count}</strong></article>
      <article class="stat-card"><p>Total Time</p><strong>${totalMin} min</strong></article>
      <article class="stat-card"><p>Average</p><strong>${avgMin} min</strong></article>
    </div>
    <h3>Recent Papers</h3>
    <ul class="profile-list">
      ${
        recent.length
          ? recent
              .map(
                (p) =>
                  `<li>${escapeHtml(p.paperTitle || "(No title)")} · ${Number(p.readingMinutes) || 0} min · ${formatDate(
                    p.readAt
                  )}</li>`
              )
              .join("")
          : "<li>No papers yet.</li>"
      }
    </ul>
  `;
}

function updateObjectiveCountdown() {
  if (!objectiveCache) {
    objectiveCountdown.textContent = "No objective countdown yet.";
    objectivePageCountdown.classList.add("hidden");
    objectivePageCountdown.textContent = "";
    return;
  }

  const { startDate, endDate } = objectiveCache;
  const timeMeta = getObjectiveTimeMeta(startDate, endDate);

  objectiveCountdown.textContent = `⏳ ${timeMeta.label}`;
  objectivePageCountdown.classList.remove("hidden");
  objectivePageCountdown.textContent = `⏳ ${timeMeta.label}`;

  const lockCountdown = document.getElementById("objectiveLockCountdown");
  if (lockCountdown) {
    lockCountdown.textContent = `⏳ ${timeMeta.label}`;
  }
}

function openProfile(uid) {
  selectedProfileUid = uid || null;
  setProfileInUrl(selectedProfileUid);
  navigateTo("profilePage", true);
  renderSelectedProfile();
}

function resetPaperFormMode() {
  editingPaperId = null;
  paperForm.reset();
  paperFormMode.classList.add("hidden");
  paperSubmitBtn.textContent = "Save Record";
  cancelEditBtn.classList.add("hidden");
}

function startObjectiveTicker() {
  stopObjectiveTicker();
  if (!objectiveCache) return;
  objectiveTickerId = setInterval(() => {
    updateObjectiveCountdown();
  }, 1000);
}

function stopObjectiveTicker() {
  if (objectiveTickerId) {
    clearInterval(objectiveTickerId);
    objectiveTickerId = null;
  }
}

function startPolling() {
  if (pollerId) return;
  pollerId = setInterval(() => {
    refreshFromServer({ preservePage: true, silent: true });
  }, POLL_INTERVAL_MS);
}

function getPastWeeks(weekCount) {
  const weeks = [];
  const today = new Date();

  for (let i = weekCount - 1; i >= 0; i -= 1) {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - i * 7);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    weeks.push({
      start,
      end,
      label: `${start.getMonth() + 1}/${start.getDate()}`,
    });
  }

  return weeks;
}

function getObjectiveTimeMeta(startDate, endDate) {
  const now = new Date();
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);

  if (now < start) {
    return { label: `Starts in ${formatCountdown(start.getTime() - now.getTime())}` };
  }
  if (now <= end) {
    return { label: `Time left ${formatCountdown(end.getTime() - now.getTime())}` };
  }
  return { label: `Ended ${formatCountdown(now.getTime() - end.getTime())} ago` };
}

function formatCountdown(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function resolveUserName(uid) {
  return usersCache.find((u) => u.uid === uid)?.displayName;
}

function formatDate(value) {
  const d = new Date(value || 0);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString();
}

function formatDateLong(value) {
  const d = new Date(value || 0);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function relativeTime(value) {
  const ts = new Date(value || 0).getTime();
  if (!Number.isFinite(ts)) return "-";

  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return formatDate(value);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isWebUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function getProfileFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("user");
  return uid && uid.trim() ? uid.trim() : null;
}

function setProfileInUrl(uid) {
  const url = new URL(window.location.href);
  if (uid) {
    url.searchParams.set("user", uid);
  } else {
    url.searchParams.delete("user");
  }
  window.history.replaceState({}, "", url);
}

function getSessionUid() {
  return localStorage.getItem(SESSION_KEY);
}

function setSessionUid(uid) {
  if (uid) {
    localStorage.setItem(SESSION_KEY, uid);
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

async function apiFetch(url, options = {}) {
  const fetchOptions = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  };

  if (options.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return payload;
}

function clearErrors() {
  authError.classList.add("hidden");
  appError.classList.add("hidden");
  authError.textContent = "";
  appError.textContent = "";
}

function showErrorText(message) {
  const inApp = !appPanel.classList.contains("hidden");
  const target = inApp ? appError : authError;
  const other = inApp ? authError : appError;
  other.classList.add("hidden");
  other.textContent = "";
  target.classList.remove("hidden");
  target.textContent = message;
}

init();
