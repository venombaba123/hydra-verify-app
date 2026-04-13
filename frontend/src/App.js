import React, { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "hydra_verify_data";
const API_URL = "https://hydra-verify.onrender.com/api/verify-drinking";

const DEFAULT_REMINDERS = [
  { id: "1", time: "09:00", enabled: true, triggered: false },
  { id: "2", time: "12:00", enabled: true, triggered: false },
  { id: "3", time: "15:00", enabled: true, triggered: false },
  { id: "4", time: "18:00", enabled: true, triggered: false },
  { id: "5", time: "21:00", enabled: true, triggered: false },
];

function getTodayKey() {
  return new Date().toDateString();
}

function createDefaultData() {
  return {
    goal: 2000,
    consumed: 0,
    reminders: DEFAULT_REMINDERS,
    lastReset: getTodayKey(),
    history: [],
    skipMode: "5min",
    hasSeenOnboarding: false,
    theme: "light",
  };
}

function loadInitialData() {
  if (typeof window === "undefined") return createDefaultData();

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return createDefaultData();

  try {
    const parsed = JSON.parse(saved);
    const today = getTodayKey();

    if (parsed.lastReset !== today) {
      const shouldSaveHistory = parsed.lastReset && (parsed.consumed > 0 || parsed.goal > 0);
      const historyEntry = shouldSaveHistory
        ? {
            date: parsed.lastReset,
            consumed: parsed.consumed,
            goal: parsed.goal,
          }
        : null;

      return {
        ...createDefaultData(),
        ...parsed,
        consumed: 0,
        lastReset: today,
        history: historyEntry ? [historyEntry, ...(parsed.history || [])].slice(0, 30) : parsed.history || [],
        reminders: (parsed.reminders || DEFAULT_REMINDERS).map((r) => ({ ...r, triggered: false })),
      };
    }

    return {
      ...createDefaultData(),
      ...parsed,
      reminders: parsed.reminders || DEFAULT_REMINDERS,
      history: parsed.history || [],
      skipMode: parsed.skipMode || "5min",
      hasSeenOnboarding: parsed.hasSeenOnboarding ?? false,
      theme: parsed.theme || "light",
    };
  } catch {
    return createDefaultData();
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function verifyDrinking(images) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ images }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Verification request failed");
  }

  return response.json();
}

export default function App() {
  const [data, setData] = useState(loadInitialData);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const [newReminderTime, setNewReminderTime] = useState("08:00");
  const [intervalHours, setIntervalHours] = useState(1);
  const [intervalStart, setIntervalStart] = useState("08:00");
  const [intervalEnd, setIntervalEnd] = useState("22:00");

  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState(null);
  const [verificationHint, setVerificationHint] = useState("");

  const [canSkipAlarm, setCanSkipAlarm] = useState(false);
  const [skipTimer, setSkipTimer] = useState(300);
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);

  const [historyRange, setHistoryRange] = useState("7days");
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);

  const isDark = data.theme === "dark";

  const theme = {
    bg: isDark ? "#0f172a" : "#eff6ff",
    bg2: isDark ? "#111827" : "#f8fafc",
    text: isDark ? "#e5eefb" : "#0f172a",
    textSoft: isDark ? "#94a3b8" : "#475569",
    card: isDark ? "#111827" : "#ffffff",
    cardBorder: isDark ? "#1f2937" : "rgba(148,163,184,0.18)",
    input: isDark ? "#1e293b" : "#ffffff",
    inputBorder: isDark ? "#334155" : "#cbd5e1",
    primary: "#2563eb",
    primarySoft: isDark ? "#172554" : "#dbeafe",
    greenSoft: isDark ? "#052e16" : "#ecfdf5",
    orangeSoft: isDark ? "#431407" : "#fff7ed",
    redSoft: isDark ? "#450a0a" : "#fef2f2",
    shadow: isDark ? "0 10px 28px rgba(0,0,0,0.35)" : "0 8px 24px rgba(15,23,42,0.08)",
    progressBg: isDark ? "#1e3a5f" : "#dbeafe",
    divider: isDark ? "#243244" : "#e2e8f0",
  };

  const streak = useMemo(() => {
    let count = 0;
    const todayMet = data.goal > 0 && data.consumed >= data.goal;

    for (const day of data.history) {
      if (day.consumed >= day.goal) count += 1;
      else break;
    }

    return todayMet ? count + 1 : count;
  }, [data]);

  const progress = data.goal > 0 ? Math.min(100, (data.consumed / data.goal) * 100) : 0;
  const glasses = Math.floor(data.consumed / 250);

  const filteredHistory =
    historyRange === "7days"
      ? data.history.slice(0, 7)
      : historyRange === "30days"
        ? data.history
        : data.history.filter((entry) => {
            const date = new Date(entry.date).toISOString().slice(0, 10);
            return date >= customStartDate && date <= customEndDate;
          });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  }, [isDark]);

  useEffect(() => {
    setShowOnboarding(!data.hasSeenOnboarding);
  }, [data.hasSeenOnboarding]);

  useEffect(() => {
    const online = () => setIsOffline(false);
    const offline = () => setIsOffline(true);

    window.addEventListener("online", online);
    window.addEventListener("offline", offline);

    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = showSettings || showHistory || showOnboarding || isAlarmActive ? "hidden" : "unset";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [showSettings, showHistory, showOnboarding, isAlarmActive]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const pendingReminder = data.reminders.find((r) => r.enabled && !r.triggered && r.time === currentTime);

      if (!pendingReminder || isAlarmActive) return;

      setIsAlarmActive(true);
      setVerificationError(null);
      setVerificationHint("Center your face and the bottle or glass in the camera.");
      setData((prev) => ({
        ...prev,
        reminders: prev.reminders.map((r) => (r.id === pendingReminder.id ? { ...r, triggered: true } : r)),
      }));
    }, 5000);

    return () => window.clearInterval(interval);
  }, [data.reminders, isAlarmActive]);

  useEffect(() => {
    let intervalId;

    if (!isAlarmActive) {
      setCanSkipAlarm(false);
      return;
    }

    if (data.skipMode === "none") {
      setSkipTimer(0);
      return;
    }

    setCanSkipAlarm(false);
    setSkipTimer(data.skipMode === "5min" ? 300 : 600);

    intervalId = window.setInterval(() => {
      setSkipTimer((prev) => {
        if (prev <= 1) {
          setCanSkipAlarm(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [isAlarmActive, data.skipMode]);

  useEffect(() => {
    if (!isAlarmActive) {
      stopAlarmSound();
      stopCamera();
      return;
    }

    playAlarmSound();

    if (isOffline) return;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 720 },
          height: { ideal: 1280 },
        },
        audio: false,
      })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        setVerificationError("Camera access is required for AI verification.");
      });

    return () => {
      stopAlarmSound();
      stopCamera();
    };
  }, [isAlarmActive, isOffline]);

  function playAlarmSound() {
    stopAlarmSound();
    const audio = new Audio("/alarm.mp3");
    audio.loop = true;
    audio.volume = 1;
    audioRef.current = audio;
    audio.play().catch(() => {});
  }

  function stopAlarmSound() {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.src = "";
    audioRef.current = null;
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      throw new Error("Camera is not ready yet. Please wait a second and try again.");
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to access the camera canvas.");

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  async function handleVerify() {
    if (isOffline) return;

    setIsVerifying(true);
    setVerificationError(null);
    setVerificationHint("Hold the bottle or glass to your mouth for about one second.");

    try {
      const frames = [];
      frames.push(captureFrame());
      await wait(350);
      frames.push(captureFrame());
      await wait(350);
      frames.push(captureFrame());

      const result = await verifyDrinking(frames);

      if (!result.isDrinking) {
        setVerificationError(result.reason || "I could not clearly confirm that you were drinking water.");
        setVerificationHint("Try brighter lighting and keep the cup or bottle visible near your mouth.");
        return;
      }

      setData((prev) => ({
        ...prev,
        consumed: Math.min(prev.consumed + 250, Math.max(prev.goal, 0) + 1000),
      }));

      setVerificationHint("Verified successfully.");
      setIsAlarmActive(false);
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : "Verification failed.");
    } finally {
      setIsVerifying(false);
    }
  }

  function addManualWater(amount) {
    setData((prev) => ({
      ...prev,
      consumed: Math.min(prev.consumed + amount, Math.max(prev.goal, 0) + 1000),
    }));
  }

  function cardStyle(bg) {
    return {
      background: bg || theme.card,
      borderRadius: 20,
      padding: 20,
      boxShadow: theme.shadow,
      border: `1px solid ${theme.cardBorder}`,
    };
  }

  function inputStyle() {
    return {
      padding: 12,
      borderRadius: 12,
      border: `1px solid ${theme.inputBorder}`,
      background: theme.input,
      color: theme.text,
    };
  }

  function buttonStyle(primary = false) {
    return {
      border: "none",
      borderRadius: 12,
      padding: "12px 16px",
      fontWeight: 700,
      cursor: "pointer",
      background: primary ? theme.primary : isDark ? "#334155" : "#e2e8f0",
      color: primary ? "#fff" : theme.text,
    };
  }

  function chipStyle(active = false) {
    return {
      border: "none",
      borderRadius: 10,
      padding: "8px 12px",
      fontWeight: 700,
      cursor: "pointer",
      background: active ? theme.primarySoft : isDark ? "#1e293b" : "#f1f5f9",
      color: active ? (isDark ? "#bfdbfe" : "#1d4ed8") : theme.textSoft,
    };
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `linear-gradient(180deg, ${theme.bg} 0%, ${theme.bg2} 55%, ${theme.card} 100%)`,
        color: theme.text,
        fontFamily: "system-ui, sans-serif",
        padding: 16,
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 36 }}>HydraVerify</h1>
            <p style={{ margin: "8px 0 0", color: theme.textSoft }}>Smart hydration reminders with AI drinking verification.</p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={chipStyle()} onClick={() => setShowHistory(true)}>History</button>
            <button style={chipStyle()} onClick={() => setShowSettings(true)}>Settings</button>
            <button
              style={chipStyle(true)}
              onClick={() => {
                setIsAlarmActive(true);
                setVerificationError(null);
                setVerificationHint("Test mode started.");
              }}
            >
              Test Alarm
            </button>
          </div>
        </div>

        <div style={{ ...cardStyle(), marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>Daily Progress</h3>
          <div style={{ fontSize: 40, fontWeight: 800 }}>
            {data.consumed}
            <span style={{ fontSize: 20, color: theme.textSoft, marginLeft: 8 }}>/ {data.goal} ml</span>
          </div>

          <div style={{ marginTop: 14, background: theme.progressBg, height: 14, borderRadius: 999 }}>
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                borderRadius: 999,
                background: "linear-gradient(90deg, #2563eb, #38bdf8)",
                transition: "width 0.3s ease",
              }}
            />
          </div>

          <div style={{ marginTop: 10, color: isDark ? "#93c5fd" : "#1d4ed8", fontWeight: 700 }}>
            {Math.round(progress)}% complete
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 18 }}>
            <div style={{ background: theme.primarySoft, padding: 14, borderRadius: 16 }}>
              <div style={{ color: theme.textSoft, fontSize: 12 }}>Glasses</div>
              <div style={{ fontWeight: 800, fontSize: 20 }}>{glasses}</div>
            </div>
            <div style={{ background: theme.orangeSoft, padding: 14, borderRadius: 16 }}>
              <div style={{ color: theme.textSoft, fontSize: 12 }}>Enabled Reminders</div>
              <div style={{ fontWeight: 800, fontSize: 20 }}>{data.reminders.filter((r) => r.enabled).length}</div>
            </div>
            <div style={{ background: theme.greenSoft, padding: 14, borderRadius: 16 }}>
              <div style={{ color: theme.textSoft, fontSize: 12 }}>Streak</div>
              <div style={{ fontWeight: 800, fontSize: 20 }}>{streak} day(s)</div>
            </div>
            <div style={{ background: isOffline ? theme.redSoft : isDark ? "#1e293b" : "#f8fafc", padding: 14, borderRadius: 16 }}>
              <div style={{ color: theme.textSoft, fontSize: 12 }}>Connection</div>
              <div style={{ fontWeight: 800, fontSize: 20, color: isOffline ? "#ef4444" : theme.text }}>
                {isOffline ? "Offline" : "Online"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button style={buttonStyle()} onClick={() => addManualWater(250)}>+ 250 ml</button>
            <button style={buttonStyle()} onClick={() => addManualWater(500)}>+ 500 ml</button>
          </div>
        </div>

        <div style={{ ...cardStyle(), marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>Reminders</h3>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <input type="time" value={newReminderTime} onChange={(e) => setNewReminderTime(e.target.value)} style={inputStyle()} />
            <button
              style={buttonStyle(true)}
              onClick={() => {
                if (!newReminderTime) return;
                const exists = data.reminders.some((r) => r.time === newReminderTime);
                if (exists) return;

                setData((prev) => ({
                  ...prev,
                  reminders: [
                    ...prev.reminders,
                    { id: Date.now().toString(), time: newReminderTime, enabled: true, triggered: false },
                  ].sort((a, b) => a.time.localeCompare(b.time)),
                }));
              }}
            >
              Add Reminder
            </button>
          </div>

          <div style={{ background: theme.primarySoft, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <h4 style={{ marginTop: 0 }}>Smart Intervals</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={intervalHours} onChange={(e) => setIntervalHours(parseFloat(e.target.value))} style={inputStyle()}>
                <option value="0.5">Every 30m</option>
                <option value="1">Every 1h</option>
                <option value="1.5">Every 1.5h</option>
                <option value="2">Every 2h</option>
                <option value="3">Every 3h</option>
              </select>
              <input type="time" value={intervalStart} onChange={(e) => setIntervalStart(e.target.value)} style={inputStyle()} />
              <input type="time" value={intervalEnd} onChange={(e) => setIntervalEnd(e.target.value)} style={inputStyle()} />
              <button
                style={buttonStyle(true)}
                onClick={() => {
                  const [startH, startM] = intervalStart.split(":").map(Number);
                  const [endH, endM] = intervalEnd.split(":").map(Number);

                  let currentMinutes = startH * 60 + startM;
                  const endMinutes = endH * 60 + endM;
                  const intervalMinutes = intervalHours * 60;

                  if (endMinutes < currentMinutes || intervalMinutes <= 0) return;

                  const newReminders = [];
                  while (currentMinutes <= endMinutes) {
                    const h = Math.floor(currentMinutes / 60);
                    const m = currentMinutes % 60;
                    newReminders.push({
                      id: `interval-${h}-${m}`,
                      time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
                      enabled: true,
                      triggered: false,
                    });
                    currentMinutes += intervalMinutes;
                  }

                  setData((prev) => ({
                    ...prev,
                    reminders: newReminders.sort((a, b) => a.time.localeCompare(b.time)),
                  }));
                }}
              >
                Generate Schedule
              </button>
            </div>
          </div>

          {data.reminders.map((reminder) => (
            <div
              key={reminder.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 0",
                borderBottom: `1px solid ${theme.divider}`,
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{reminder.time}</div>
                <div style={{ fontSize: 12, color: theme.textSoft }}>
                  {!reminder.enabled ? "Disabled" : reminder.triggered ? "Completed today" : "Upcoming"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  style={buttonStyle()}
                  onClick={() => {
                    setData((prev) => ({
                      ...prev,
                      reminders: prev.reminders.filter((r) => r.id !== reminder.id),
                    }));
                  }}
                >
                  Delete
                </button>
                <input
                  type="checkbox"
                  checked={reminder.enabled}
                  onChange={(e) => {
                    setData((prev) => ({
                      ...prev,
                      reminders: prev.reminders.map((r) => (r.id === reminder.id ? { ...r, enabled: e.target.checked } : r)),
                    }));
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {showSettings && (
          <div style={{ ...cardStyle(), marginTop: 20 }}>
            <h3 style={{ marginTop: 0 }}>Settings</h3>
            <div style={{ display: "grid", gap: 14 }}>
              <label>
                <div style={{ marginBottom: 6, fontWeight: 700 }}>Daily Goal (ml)</div>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={data.goal}
                  onChange={(e) => {
                    const goal = Math.max(0, Number(e.target.value) || 0);
                    setData((prev) => ({ ...prev, goal }));
                  }}
                  style={{ ...inputStyle(), width: "100%", maxWidth: 240 }}
                />
              </label>

              <label>
                <div style={{ marginBottom: 6, fontWeight: 700 }}>Auto-Skip Alarm</div>
                <select
                  value={data.skipMode}
                  onChange={(e) => setData((prev) => ({ ...prev, skipMode: e.target.value }))}
                  style={{ ...inputStyle(), width: "100%", maxWidth: 240 }}
                >
                  <option value="5min">5 minutes</option>
                  <option value="10min">10 minutes</option>
                  <option value="none">No skip</option>
                </select>
              </label>

              <div>
                <div style={{ marginBottom: 8, fontWeight: 700 }}>Dark Mode</div>
                <button
                  style={buttonStyle(data.theme === "dark")}
                  onClick={() => setData((prev) => ({ ...prev, theme: prev.theme === "dark" ? "light" : "dark" }))}
                >
                  {data.theme === "dark" ? "Dark Mode: On" : "Dark Mode: Off"}
                </button>
              </div>

              <div style={{ color: theme.textSoft, fontSize: 14 }}>
                {data.skipMode === "none"
                  ? "Hardcore mode: only successful drinking verification stops the alarm."
                  : `Skip becomes available after ${data.skipMode.replace("min", "")} minutes.`}
              </div>

              <div>
                <button style={buttonStyle(true)} onClick={() => setShowSettings(false)}>
                  Close Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {showHistory && (
          <div style={{ ...cardStyle(), marginTop: 20 }}>
            <h3 style={{ marginTop: 0 }}>Hydration History</h3>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <button style={chipStyle(historyRange === "7days")} onClick={() => setHistoryRange("7days")}>7 Days</button>
              <button style={chipStyle(historyRange === "30days")} onClick={() => setHistoryRange("30days")}>30 Days</button>
              <button style={chipStyle(historyRange === "custom")} onClick={() => setHistoryRange("custom")}>Custom</button>
              <button style={buttonStyle()} onClick={() => setShowHistory(false)}>Close</button>
            </div>

            {historyRange === "custom" && (
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} style={inputStyle()} />
                <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} style={inputStyle()} />
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 18 }}>
              <div style={{ background: theme.primarySoft, padding: 14, borderRadius: 16 }}>
                <div style={{ fontSize: 12, color: theme.textSoft }}>Average Intake</div>
                <div style={{ fontWeight: 800, fontSize: 22 }}>
                  {filteredHistory.length ? Math.round(filteredHistory.reduce((a, c) => a + c.consumed, 0) / filteredHistory.length) : 0} ml
                </div>
              </div>
              <div style={{ background: theme.greenSoft, padding: 14, borderRadius: 16 }}>
                <div style={{ fontSize: 12, color: theme.textSoft }}>Goal Success</div>
                <div style={{ fontWeight: 800, fontSize: 22 }}>
                  {filteredHistory.length
                    ? Math.round((filteredHistory.filter((h) => h.consumed >= h.goal).length / filteredHistory.length) * 100)
                    : 0}%
                </div>
              </div>
              <div style={{ background: theme.orangeSoft, padding: 14, borderRadius: 16 }}>
                <div style={{ fontSize: 12, color: theme.textSoft }}>Best Day</div>
                <div style={{ fontWeight: 800, fontSize: 22 }}>
                  {filteredHistory.length ? Math.max(...filteredHistory.map((h) => h.consumed)) : 0} ml
                </div>
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <p style={{ color: theme.textSoft }}>No history yet. Keep going.</p>
            ) : (
              filteredHistory.map((entry, index) => (
                <div key={index} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${theme.divider}` }}>
                  <div>{new Date(entry.date).toLocaleDateString()}</div>
                  <div style={{ fontWeight: 700 }}>{entry.consumed}/{entry.goal} ml</div>
                </div>
              ))
            )}
          </div>
        )}

        {isAlarmActive && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(220, 38, 38, 0.96)",
              color: "white",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
              zIndex: 9999,
              textAlign: "center",
            }}
          >
            <h2 style={{ fontSize: 38, marginBottom: 8 }}>Hydration Alert</h2>
            <p style={{ maxWidth: 420, marginBottom: 16 }}>
              {isOffline ? "You are offline. AI verification is unavailable right now." : "Drink water, then verify with the camera."}
            </p>

            <div
              style={{
                width: "100%",
                maxWidth: 340,
                aspectRatio: "1 / 1",
                background: "black",
                borderRadius: 20,
                overflow: "hidden",
                marginBottom: 16,
                border: "4px solid rgba(255,255,255,0.2)",
              }}
            >
              {!isOffline ? (
                <>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <canvas ref={canvasRef} style={{ display: "none" }} />
                </>
              ) : (
                <div style={{ padding: 24 }}>Drink water and confirm manually.</div>
              )}
            </div>

            {verificationHint && <p style={{ maxWidth: 380, opacity: 0.9 }}>{verificationHint}</p>}
            {verificationError && <p style={{ maxWidth: 380, color: "#fee2e2", fontWeight: 700 }}>{verificationError}</p>}

            {!isOffline ? (
              <button
                style={{ ...buttonStyle(true), background: "#fff", color: "#dc2626", fontSize: 18, marginTop: 12 }}
                onClick={handleVerify}
                disabled={isVerifying}
              >
                {isVerifying ? "Verifying..." : "Verify Drinking"}
              </button>
            ) : (
              <button
                style={{ ...buttonStyle(true), background: "#facc15", color: "#111827", fontSize: 18, marginTop: 12 }}
                onClick={() => {
                  setIsAlarmActive(false);
                  setData((prev) => ({
                    ...prev,
                    consumed: Math.min(prev.consumed + 250, Math.max(prev.goal, 0) + 1000),
                  }));
                }}
              >
                Confirm I Drank Water
              </button>
            )}

            {canSkipAlarm ? (
              <button style={{ ...buttonStyle(), marginTop: 16 }} onClick={() => setIsAlarmActive(false)}>
                Skip Alarm
              </button>
            ) : data.skipMode !== "none" ? (
              <p style={{ marginTop: 16, opacity: 0.85 }}>
                Skip available in {Math.floor(skipTimer / 60)}:{String(skipTimer % 60).padStart(2, "0")}
              </p>
            ) : (
              <p style={{ marginTop: 16, opacity: 0.85 }}>No skip allowed</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
