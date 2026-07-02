"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CATEGORIES, REFINEMENTS, PRIORITIES, catOf, studentMeta, neisBytes, charCount, uid, newActivity,
  pushHistorySnapshot, MAX_HISTORY,
} from "@/lib/categories";

// 히스토리 타임스탬프 표시용: "07/02 14:23"
function formatHistDate(iso) {
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return ""; }
}

// initialEntries(평면) → 학생별로 묶기
function groupStudents(students, entries) {
  const byStudent = {};
  for (const e of entries) {
    (byStudent[e.student_id] = byStudent[e.student_id] || []).push({
      ...e,
      activities: Array.isArray(e.activities) ? e.activities : [],
    });
  }
  return students.map((s) => ({ ...s, entries: byStudent[s.id] || [] }));
}

const gnum = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? Infinity : n; };

// 학년/반으로 학생 묶기 (사이드바 분류용)
function groupByClass(students) {
  const groups = {};
  for (const s of students) {
    const g = (s.grade || "").trim();
    const k = (s.klass || "").trim();
    const key = (g || k) ? `${g}|${k}` : "__none__";
    if (!groups[key]) {
      const label = g && k ? `${g}학년 ${k}반` : g ? `${g}학년` : k ? `${k}반` : "미분류";
      groups[key] = { key, label, grade: g, klass: k, students: [] };
    }
    groups[key].students.push(s);
  }
  const arr = Object.values(groups);
  for (const grp of arr) {
    grp.students.sort((a, b) =>
      gnum(a.number) - gnum(b.number) || (a.name || "").localeCompare(b.name || "", "ko"));
  }
  arr.sort((a, b) => {
    if (a.key === "__none__") return 1;
    if (b.key === "__none__") return -1;
    return gnum(a.grade) - gnum(b.grade) || gnum(a.klass) - gnum(b.klass);
  });
  return arr;
}

export default function Workspace({ initialStudents, initialEntries, userEmail }) {
  const router = useRouter();
  const supabase = createClient();

  const [students, setStudents] = useState(() => groupStudents(initialStudents, initialEntries));
  const [activeSid, setActiveSid] = useState(initialStudents[0]?.id || null);
  const [activeEid, setActiveEid] = useState(() => {
    const grouped = groupStudents(initialStudents, initialEntries);
    return grouped[0]?.entries[0]?.id || null;
  });
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved
  const [addOpen, setAddOpen] = useState(false);      // 사이드바 학생 추가 폼
  const [navOpen, setNavOpen] = useState(false);      // 모바일 사이드바 드로어
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState({}); // { [groupKey]: true } = 접힘
  const [add, setAdd] = useState({ name: "", school: "", subject: "", grade: "", klass: "", number: "" });
  const [editOpen, setEditOpen] = useState(false); // 학생 정보 수정 모달
  const [edit, setEdit] = useState({ name: "", school: "", grade: "", klass: "", number: "" });
  const [delTarget, setDelTarget] = useState(null); // 삭제 확인 대상 { id, name }
  const [refineText, setRefineText] = useState("");  // 직접 입력 수정 요청
  const [byteOpen, setByteOpen] = useState(false);   // 바이트 계산기 모달
  const [byteText, setByteText] = useState("");
  const [byteTarget, setByteTarget] = useState(1500);
  const [byteCat, setByteCat] = useState("subject"); // 바이트 계산기 AI 수정 기준 영역
  const [byteLoading, setByteLoading] = useState(false);
  const [byteLoadingMsg, setByteLoadingMsg] = useState("");
  const [byteError, setByteError] = useState("");
  const [byteNotes, setByteNotes] = useState("");
  const [byteRefineText, setByteRefineText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false); // 초안 이력 모달
  const [provider, setProvider] = useState("gemini"); // 사용 중인 AI 제공자: gemini | openai
  const [geminiKey, setGeminiKey] = useState("");     // 기기별 사용자 Gemini 키
  const [openaiKey, setOpenaiKey] = useState("");     // 기기별 사용자 ChatGPT(OpenAI) 키
  const [keyOpen, setKeyOpen] = useState(false);      // 키 입력 모달
  const [keyProvider, setKeyProvider] = useState("gemini"); // 모달 내 선택된 제공자 탭
  const [keyInput, setKeyInput] = useState("");       // 모달 임시 입력값
  const apiKey = provider === "openai" ? openaiKey : geminiKey;
  const PROVIDERS = {
    gemini: { label: "Gemini", placeholder: "AIza...", linkLabel: "Google AI Studio에서 무료로 발급받기 ↗", linkHref: "https://aistudio.google.com/app/apikey" },
    openai: { label: "ChatGPT", placeholder: "sk-...", linkLabel: "OpenAI 플랫폼에서 API 키 발급받기 ↗", linkHref: "https://platform.openai.com/api-keys" },
  };
  const [installEvt, setInstallEvt] = useState(null); // PWA 설치 프롬프트 이벤트
  const addNameRef = useRef(null);
  const resultRef = useRef(null);
  const saveTimers = useRef({});

  useEffect(() => { if (addOpen) setTimeout(() => addNameRef.current?.focus(), 30); }, [addOpen]);

  // 기기별 저장된 제공자·API 키 불러오기
  useEffect(() => {
    try {
      const p = localStorage.getItem("ai_provider");
      if (p === "openai" || p === "gemini") setProvider(p);
      setGeminiKey(localStorage.getItem("gemini_api_key") || "");
      setOpenaiKey(localStorage.getItem("openai_api_key") || "");
    } catch {}
  }, []);

  // PWA 설치 가능 시점 포착
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function installApp() {
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch {}
    setInstallEvt(null);
  }

  function openKeyModal() {
    setKeyProvider(provider);
    setKeyInput(provider === "openai" ? openaiKey : geminiKey);
    setKeyOpen(true);
  }
  function switchKeyTab(p) {
    setKeyProvider(p);
    setKeyInput(p === "openai" ? openaiKey : geminiKey);
  }
  function saveKey() {
    const v = keyInput.trim();
    const storageKey = keyProvider === "openai" ? "openai_api_key" : "gemini_api_key";
    try {
      v ? localStorage.setItem(storageKey, v) : localStorage.removeItem(storageKey);
      localStorage.setItem("ai_provider", keyProvider);
    } catch {}
    if (keyProvider === "openai") setOpenaiKey(v); else setGeminiKey(v);
    setProvider(keyProvider);
    setKeyOpen(false);
  }
  function clearKey() {
    const storageKey = keyProvider === "openai" ? "openai_api_key" : "gemini_api_key";
    try { localStorage.removeItem(storageKey); } catch {}
    if (keyProvider === "openai") setOpenaiKey(""); else setGeminiKey("");
    setKeyInput(""); setKeyOpen(false);
  }

  const student = students.find((s) => s.id === activeSid) || null;
  const entry = student?.entries.find((e) => e.id === activeEid) || null;
  const cat = entry ? catOf(entry.category) : null;

  // ── 저장 (디바운스) ──
  function scheduleSave(eid, fields) {
    setSaveState("saving");
    clearTimeout(saveTimers.current[eid]);
    saveTimers.current[eid] = setTimeout(async () => {
      const { error } = await supabase.from("entries")
        .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", eid);
      setSaveState(error ? "idle" : "saved");
    }, 600);
  }

  // ── 학생 ──
  function selectStudent(id) {
    const s = students.find((x) => x.id === id);
    setActiveSid(id); setActiveEid(s?.entries[0]?.id || null);
    setNavOpen(false);
  }
  async function addStudent() {
    if (!add.name.trim()) return;
    const { data: srow, error } = await supabase.from("students")
      .insert({ name: add.name.trim(), school: add.school.trim(), grade: add.grade.trim(), klass: add.klass.trim(), number: add.number.trim() })
      .select().single();
    if (error || !srow) { setError("학생 추가 실패: " + (error?.message || "")); return; }

    const defActs = [newActivity()];
    const c = catOf("subject");
    const { data: erow } = await supabase.from("entries")
      .insert({ student_id: srow.id, category: "subject", subject: add.subject.trim(), activities: defActs, target: c.target, draft: "", notes: "" })
      .select().single();

    const newStudent = { ...srow, entries: erow ? [{ ...erow, activities: defActs }] : [] };
    setStudents((arr) => [...arr, newStudent]);
    setActiveSid(srow.id); setActiveEid(erow?.id || null);
    // 같은 학급·과목 학생을 이어서 추가하기 쉽도록 학교/과목/학년/반은 유지하고 이름·번호만 비움
    setAdd((p) => ({ name: "", school: p.school, subject: p.subject, grade: p.grade, klass: p.klass, number: "" }));
    setAddOpen(false);
  }
  async function deleteStudent(id) {
    await supabase.from("students").delete().eq("id", id); // entries는 ON DELETE CASCADE
    setStudents((arr) => arr.filter((s) => s.id !== id));
    if (id === activeSid) {
      const rest = students.filter((s) => s.id !== id);
      setActiveSid(rest[0]?.id || null);
      setActiveEid(rest[0]?.entries[0]?.id || null);
    }
  }
  function openEdit() {
    if (!student) return;
    setEdit({
      name: student.name || "", school: student.school || "",
      grade: student.grade || "", klass: student.klass || "", number: student.number || "",
    });
    setError(""); setEditOpen(true);
  }
  async function saveEdit() {
    if (!student || !edit.name.trim()) return;
    const fields = {
      name: edit.name.trim(), school: edit.school.trim(),
      grade: edit.grade.trim(), klass: edit.klass.trim(), number: edit.number.trim(),
    };
    const { error } = await supabase.from("students").update(fields).eq("id", student.id);
    if (error) { setError("학생 정보 수정 실패: " + error.message); return; }
    setStudents((arr) => arr.map((s) => s.id === student.id ? { ...s, ...fields } : s));
    setEditOpen(false);
  }

  // ── 항목 ──
  async function addEntry() {
    if (!student) return;
    const c = catOf(entry?.category || "subject");
    const subjDefault = c.key === "subject" ? (entry?.subject || "") : "";
    const defActs = [newActivity()];
    const { data: erow, error } = await supabase.from("entries")
      .insert({ student_id: student.id, category: c.key, subject: subjDefault, activities: defActs, target: c.target, draft: "", notes: "" })
      .select().single();
    if (error || !erow) { setError("항목 추가 실패: " + (error?.message || "")); return; }
    const e = { ...erow, activities: defActs };
    setStudents((arr) => arr.map((s) => s.id !== activeSid ? s : { ...s, entries: [...s.entries, e] }));
    setActiveEid(e.id);
  }
  async function deleteEntry(eid) {
    await supabase.from("entries").delete().eq("id", eid);
    setStudents((arr) => arr.map((s) => s.id !== activeSid ? s : { ...s, entries: s.entries.filter((e) => e.id !== eid) }));
    if (eid === activeEid) {
      const rest = student.entries.filter((e) => e.id !== eid);
      setActiveEid(rest[0]?.id || null);
    }
  }
  const patchEntry = useCallback((patch, { persist = true } = {}) => {
    setStudents((arr) => arr.map((s) => s.id !== activeSid ? s : {
      ...s, entries: s.entries.map((e) => e.id !== activeEid ? e : { ...e, ...patch }),
    }));
    if (persist) scheduleSave(activeEid, patch);
  }, [activeSid, activeEid]);

  const setActivities = (fn) => {
    const next = fn(entry.activities);
    patchEntry({ activities: next });
  };
  const updateActivity = (id, field, val) => setActivities((a) => a.map((x) => x.id === id ? { ...x, [field]: val } : x));
  const addActivity = () => setActivities((a) => [...a, newActivity()]);
  const removeActivity = (id) => setActivities((a) => a.length > 1 ? a.filter((x) => x.id !== id) : a);

  // 제목을 지정해 활동 추가 — 비어 있는 단일 활동이면 거기에 채우고, 아니면 새로 추가
  const addActivityWithTitle = (title) => setActivities((a) => {
    const onlyEmpty = a.length === 1 && !a[0].title.trim() && !a[0].detail.trim() && !a[0].meaning.trim();
    return onlyEmpty ? [{ ...a[0], title }] : [...a, { ...newActivity(), title }];
  });

  // 모든 학생의 세특(subject) 항목에서 과목별로 사용된 활동 제목을 모은다.
  const subjectTitleLibrary = useMemo(() => {
    const map = {};
    for (const s of students) {
      for (const e of (s.entries || [])) {
        if (e.category !== "subject") continue;
        const subj = (e.subject || "").trim();
        if (!subj) continue;
        for (const a of (e.activities || [])) {
          const t = (a.title || "").trim();
          if (!t) continue;
          (map[subj] = map[subj] || new Set()).add(t);
        }
      }
    }
    const out = {};
    for (const k in map) out[k] = [...map[k]];
    return out;
  }, [students]);

  const subjKey = (entry?.subject || "").trim();
  const isSubjectEntry = cat?.key === "subject";
  const allSubjectTitles = isSubjectEntry && subjKey ? (subjectTitleLibrary[subjKey] || []) : [];
  const presentTitles = new Set((entry?.activities || []).map((a) => (a.title || "").trim()).filter(Boolean));
  const suggestedTitles = allSubjectTitles.filter((t) => !presentTitles.has(t));

  const hasContent = entry?.activities.some((a) => a.title.trim() || a.detail.trim());

  // ── AI ──
  // 공통 호출: /api/generate 요청 + 에러 메시지 매핑. 성공 시 { draft, notes } 반환, 실패 시 throw.
  async function callGenerate(payload) {
    const res = await fetch("/api/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, provider, apiKey }),
    });
    const data = await res.json();
    if (!res.ok) {
      const fail = (msg) => { const e = new Error(msg); e.friendly = true; return e; };
      const providerLabel = PROVIDERS[provider].label;
      if (data?.code === "NO_API_KEY" || data?.code === "BAD_API_KEY") {
        openKeyModal();
        throw fail(data.error + ` · 왼쪽 아래 [API 키]에서 본인 ${providerLabel} 키를 등록해 주세요.`);
      }
      if (data?.code === "RATE_LIMIT") throw fail("API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.");
      if (data?.code === "AI_BUSY") throw fail(`${providerLabel} 서버가 잠시 혼잡합니다. 잠시 후 다시 눌러 주세요.`);
      throw fail("생성 실패: " + (data?.detail || data?.error || "알 수 없는 오류"));
    }
    return { draft: data.draft || "", notes: data.notes || "" };
  }

  async function runGenerate(payload, msg) {
    setError(""); setCopied(false); setLoading(true); setLoadingMsg(msg);
    try {
      const { draft, notes } = await callGenerate(payload);
      // AI가 초안을 덮어쓰기 전, 기존 초안이 있었다면 이력에 남겨둔다.
      const prevDraft = (entry.draft || "").trim();
      const history = prevDraft
        ? pushHistorySnapshot(entry.history, {
            draft: entry.draft, notes: entry.notes || "",
            label: payload.mode === "refine" ? "AI 다듬기 전" : "새로 작성 전",
          })
        : (entry.history || []);
      patchEntry({ draft, notes, history });
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e) {
      setError(e?.friendly ? e.message : "생성 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally { setLoading(false); }
  }

  // 현재 초안을 이력에 그대로 저장(수동 체크포인트) — 초안 자체는 바뀌지 않는다.
  function snapshotNow() {
    if (!entry?.draft?.trim()) return;
    patchEntry({
      history: pushHistorySnapshot(entry.history, { draft: entry.draft, notes: entry.notes || "", label: "수동 저장" }),
    });
  }
  // 이력의 특정 버전으로 복원 — 복원 전 현재 초안도 이력에 남긴다.
  function restoreVersion(v) {
    if (!entry) return;
    const prevDraft = (entry.draft || "").trim();
    const history = prevDraft && prevDraft !== v.draft
      ? pushHistorySnapshot(entry.history, { draft: entry.draft, notes: entry.notes || "", label: "복원 전" })
      : (entry.history || []);
    patchEntry({ draft: v.draft, notes: v.notes || "", history });
    setHistoryOpen(false);
  }
  function removeVersion(id) {
    patchEntry({ history: (entry.history || []).filter((h) => h.id !== id) });
  }
  const generate = () => runGenerate(
    { mode: "generate", category: entry.category, subject: entry.subject, target: entry.target, activities: entry.activities },
    "활동 기록을 검토하는 중…"
  );
  const refine = (instruction) => entry.draft.trim() && runGenerate(
    { mode: "refine", category: entry.category, subject: entry.subject, target: entry.target, draft: entry.draft, instruction },
    "초안을 다듬는 중…"
  );
  function submitRefine() {
    const t = refineText.trim();
    if (!t || loading || !entry?.draft.trim()) return;
    refine(t);
    setRefineText("");
  }

  // ── 바이트 계산기 AI 수정 ──
  async function refineByte(instruction, msg) {
    const src = byteText.trim();
    if (!src || byteLoading) return;
    setByteError(""); setByteNotes(""); setByteLoading(true); setByteLoadingMsg(msg);
    try {
      const { draft, notes } = await callGenerate({
        mode: "refine", category: byteCat, subject: "", target: byteTarget || 1500, draft: src, instruction,
      });
      setByteText(draft || src);
      setByteNotes(notes || "");
    } catch (e) {
      setByteError(e?.friendly ? e.message : "수정 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally { setByteLoading(false); }
  }
  function submitByteRefine() {
    const t = byteRefineText.trim();
    if (!t || byteLoading || !byteText.trim()) return;
    refineByte(t, "내용을 다듬는 중…");
    setByteRefineText("");
  }
  function pickByteCat(key) {
    setByteCat(key);
    setByteTarget(catOf(key).target); // 영역 선택 시 권장 분량을 기준 바이트로
  }

  function copyDraft() {
    navigator.clipboard?.writeText(entry.draft).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }
  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login"); router.refresh();
  }

  const filtered = students.filter((s) => !query.trim() || s.name.includes(query.trim()));
  const searching = !!query.trim();
  const groups = groupByClass(filtered);
  const toggleGroup = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  const bytes = entry ? neisBytes(entry.draft) : 0;
  const over = entry ? bytes > entry.target : false;
  const gaugePct = entry ? Math.min((bytes / Math.max(entry.target, 1)) * 100, 100) : 0;
  const gaugeClass = entry ? (over ? "over" : bytes > entry.target * 0.9 ? "near" : "") : "";

  // 바이트 계산기
  const byteBytes = neisBytes(byteText);
  const byteOver = byteTarget > 0 && byteBytes > byteTarget;
  const bytePct = byteTarget > 0 ? Math.min((byteBytes / byteTarget) * 100, 100) : 0;
  const byteGauge = byteOver ? "over" : (byteTarget > 0 && byteBytes > byteTarget * 0.9) ? "near" : "";

  return (
    <div className="sg-app">
      {navOpen && <div className="sg-scrim" onClick={() => setNavOpen(false)} />}

      {/* ───────────── 사이드바 ───────────── */}
      <aside className={"sg-side" + (navOpen ? " open" : "")}>
        <div className="sg-side-brand">
          <div className="sg-side-mark">생활기록부 도우미<small>학교생활기록부 초안 작성 · 교사용</small></div>
        </div>

        <div className="sg-side-tools">
          <button className={"sg-newbtn" + (addOpen ? " open" : "")} onClick={() => setAddOpen((o) => !o)}>
            {addOpen ? "✕ 닫기" : "＋ 새 학생 추가"}
          </button>
          <input className="sg-search" placeholder="학생 이름 검색"
                 value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {addOpen && (
          <div className="sg-addform">
            <input ref={addNameRef} placeholder="이름" value={add.name}
                   onChange={(e) => setAdd({ ...add, name: e.target.value })}
                   onKeyDown={(e) => e.key === "Enter" && addStudent()} />
            <input placeholder="학교 (선택)" value={add.school}
                   onChange={(e) => setAdd({ ...add, school: e.target.value })}
                   onKeyDown={(e) => e.key === "Enter" && addStudent()} />
            <input placeholder="과목 (세특 기본 과목, 선택)" value={add.subject}
                   onChange={(e) => setAdd({ ...add, subject: e.target.value })}
                   onKeyDown={(e) => e.key === "Enter" && addStudent()} />
            <div className="sg-add-row">
              <input placeholder="학년" value={add.grade} onChange={(e) => setAdd({ ...add, grade: e.target.value })} />
              <input placeholder="반" value={add.klass} onChange={(e) => setAdd({ ...add, klass: e.target.value })} />
              <input placeholder="번호" value={add.number} onChange={(e) => setAdd({ ...add, number: e.target.value })} />
              <button className="sg-addbtn" onClick={addStudent} disabled={!add.name.trim()}>추가</button>
            </div>
          </div>
        )}

        <div className="sg-side-list">
          <div className="sg-list-label">학생 {students.length}명 · {groupByClass(students).length}개 학급</div>
          {groups.map((grp) => {
            const isCollapsed = !searching && collapsed[grp.key];
            return (
              <div className="sg-group" key={grp.key}>
                <button
                  className={"sg-group-head" + (isCollapsed ? " collapsed" : "") + (searching ? " no-toggle" : "")}
                  onClick={searching ? undefined : () => toggleGroup(grp.key)}
                >
                  {!searching && <span className="sg-group-caret">▾</span>}
                  <span className="sg-group-name">{grp.label}</span>
                  <span className="sg-group-count">{grp.students.length}</span>
                </button>
                {!isCollapsed && grp.students.map((s) => (
                  <div key={s.id} className={"sg-srow" + (s.id === activeSid ? " on" : "")} onClick={() => selectStudent(s.id)}>
                    <div className="sg-srow-av">{(s.name || "?").trim().charAt(0)}</div>
                    <div className="sg-srow-main">
                      <div className="sg-srow-name">{s.name}</div>
                      <div className="sg-srow-meta">{s.number ? `${s.number}번 · ` : ""}{s.entries.length}개 항목</div>
                    </div>
                    <button className="sg-srow-x" onClick={(e) => { e.stopPropagation(); setDelTarget({ id: s.id, name: s.name }); }} aria-label="학생 삭제">✕</button>
                  </div>
                ))}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="sg-list-empty">
              {students.length ? "검색 결과가 없습니다." : "위 ＋ 새 학생 추가로\n학생을 등록하세요."}
            </div>
          )}
        </div>

        <div className="sg-side-foot">
          <div className="sg-foot-user">
            <span className="sg-foot-dot" />
            <span className="sg-foot-email">{userEmail}</span>
            <span className="sg-topbar-spacer" />
            <span className={"sg-save sg-save-" + saveState}>
              {saveState === "saving" ? "저장 중…" : saveState === "saved" ? "저장됨 ✓" : ""}
            </span>
          </div>
          <div className="sg-foot-actions">
            <button className="sg-fbtn" onClick={() => setByteOpen(true)}>바이트 계산기</button>
            <button className={"sg-fbtn key" + (apiKey ? " on" : "")} onClick={openKeyModal}>
              {PROVIDERS[provider].label} 키{apiKey ? " ✓" : ""}
            </button>
            {installEvt && <button className="sg-fbtn install" onClick={installApp}>⬇ 앱 설치</button>}
            <button className="sg-fbtn danger" onClick={signOut}>로그아웃</button>
          </div>
        </div>
      </aside>

      {/* ───────────── 메인 ───────────── */}
      <div className="sg-main">
        <div className="sg-topbar">
          <button className="sg-burger" onClick={() => setNavOpen(true)} aria-label="메뉴">☰</button>
          {student ? (
            <div className="sg-topbar-id">
              <span className="sg-topbar-name">{student.name}</span>
              {studentMeta(student) && <span className="sg-topbar-meta">{studentMeta(student)}</span>}
            </div>
          ) : (
            <span className="sg-topbar-name" style={{ fontSize: 18 }}>생활기록부 도우미</span>
          )}
          <span className="sg-topbar-spacer" />
          {student && <button className="sg-topbar-edit" onClick={openEdit}>학생 정보 수정</button>}
        </div>

        {!student ? (
          <div className="sg-blank">
            <div>
              <div className="sg-blank-mark">생기부</div>
              <h2>학생을 추가해 시작하세요</h2>
              <p>왼쪽 <b>＋ 새 학생 추가</b>로 학생을 등록하면<br />영역별 생기부 초안 작성을 시작할 수 있습니다.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="sg-tabs">
              {student.entries.map((e) => {
                const c = catOf(e.category);
                return (
                  <button key={e.id} className={"sg-tab" + (e.id === activeEid ? " on" : "")} onClick={() => setActiveEid(e.id)}>
                    {c.short}{c.needsSubject && e.subject ? `·${e.subject}` : ""}
                    <span className="sg-tab-x" onClick={(ev) => { ev.stopPropagation(); deleteEntry(e.id); }}>✕</span>
                  </button>
                );
              })}
              <button className="sg-tab add" onClick={addEntry}>＋ 새 항목</button>
            </div>

            <div className="sg-canvas">
              {entry && (
                <>
                  <div className="sg-card">
                    <div className="sg-eyebrow">영역 · 분량</div>
                    <div className="sg-chips">
                      {CATEGORIES.map((c) => (
                        <button key={c.key} className={"sg-chip" + (c.key === entry.category ? " on" : "")}
                                onClick={() => patchEntry({ category: c.key })}>{c.label}</button>
                      ))}
                    </div>
                    <div className="sg-row">
                      {cat.needsSubject && (
                        <div className="sg-field" style={{ flex: 1, minWidth: 200 }}>
                          <label>과목</label>
                          <input className="sg-input" placeholder="예) 통합과학, 문학, 미적분"
                                 value={entry.subject || ""} onChange={(e) => patchEntry({ subject: e.target.value })} />
                        </div>
                      )}
                      <div className="sg-field" style={{ width: 170 }}>
                        <label>권장 분량 <span className="sub">(NEIS 바이트)</span></label>
                        <input className="sg-input" type="number" min={300} max={4000} step={50}
                               value={entry.target} onChange={(e) => patchEntry({ target: Number(e.target.value) || 0 })} />
                      </div>
                    </div>
                  </div>

                  <div className="sg-card">
                    <div className="sg-eyebrow">활동 기록</div>
                    <p className="sg-help"><b>한 일 / 관찰</b>은 사실 위주로, <b>의미 / 성장</b>은 드러난 역량이나 변화를 적으면 초안 품질이 좋아집니다.</p>
                    {isSubjectEntry && subjKey && suggestedTitles.length > 0 && (
                      <div className="sg-suggest">
                        <span className="sg-suggest-label">같은 과목「{subjKey}」 활동 제목 불러오기</span>
                        <div className="sg-suggest-chips">
                          {suggestedTitles.map((t) => (
                            <button key={t} type="button" className="sg-suggest-chip"
                                    onClick={() => addActivityWithTitle(t)}>＋ {t}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="sg-acts">
                      {entry.activities.map((a, i) => (
                        <div className="sg-act" key={a.id}>
                          <div className="sg-act-head">
                            <span className="sg-act-no">{String(i + 1).padStart(2, "0")}</span>
                            <input className="sg-act-title" placeholder="활동 제목 (예: 환경 캠페인 기획)"
                                   list={isSubjectEntry ? "sg-subj-titles" : undefined}
                                   value={a.title} onChange={(e) => updateActivity(a.id, "title", e.target.value)} />
                            <div className="sg-prio" role="group" aria-label="우선순위">
                              <span className="sg-prio-label">우선순위</span>
                              {PRIORITIES.map((p) => (
                                <button key={p.v} type="button"
                                        className={"sg-prio-b p" + p.v + ((a.priority ?? 1) === p.v ? " on" : "")}
                                        title={p.label + " · " + p.hint}
                                        onClick={() => updateActivity(a.id, "priority", p.v)}>
                                  {p.label}
                                </button>
                              ))}
                            </div>
                            <button className="sg-del" onClick={() => removeActivity(a.id)} disabled={entry.activities.length === 1} aria-label="활동 삭제">✕</button>
                          </div>
                          <textarea className="sg-area" rows={2} placeholder="한 일 / 관찰한 내용 — 무엇을, 어떻게 했는지"
                                    value={a.detail} onChange={(e) => updateActivity(a.id, "detail", e.target.value)} />
                          <textarea className="sg-area" rows={2} placeholder="의미 / 성장 — 드러난 역량, 태도, 변화 (선택)"
                                    value={a.meaning} onChange={(e) => updateActivity(a.id, "meaning", e.target.value)} />
                        </div>
                      ))}
                    </div>
                    {isSubjectEntry && allSubjectTitles.length > 0 && (
                      <datalist id="sg-subj-titles">
                        {allSubjectTitles.map((t) => <option key={t} value={t} />)}
                      </datalist>
                    )}
                    <button className="sg-addact" onClick={addActivity}>＋ 활동 추가</button>
                  </div>

                  <button className="sg-generate" onClick={generate} disabled={!hasContent || loading}>
                    {loading ? loadingMsg : "생기부 초안 작성"}
                  </button>
                  {!hasContent && <p className="sg-hint">활동을 한 개 이상 입력하면 작성할 수 있어요.</p>}

                  <div className="sg-card sg-result" ref={resultRef}>
                    <div className="sg-result-top">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="sg-result-eyebrow">초안 · {cat.label}{cat.needsSubject && entry.subject ? ` · ${entry.subject}` : ""}</div>
                        {entry.draft && (
                          <>
                            <div className="sg-count">
                              <span className={over ? "warn" : "ok"}>{bytes}바이트</span>
                              <span className="dim"> / {entry.target}바이트 · {charCount(entry.draft)}자</span>
                              {over && <span className="warn"> · 초과</span>}
                            </div>
                            <div className="sg-gauge"><div className={"sg-gauge-fill " + gaugeClass} style={{ width: gaugePct + "%" }} /></div>
                          </>
                        )}
                      </div>
                      {entry.draft && (
                        <div className="sg-result-actions">
                          <button className="sg-copy" onClick={snapshotNow} title="현재 초안을 이력에 저장">스냅샷</button>
                          <button className="sg-copy" onClick={() => setHistoryOpen(true)}>
                            이력{entry.history?.length ? ` (${entry.history.length})` : ""}
                          </button>
                          <button className="sg-copy" onClick={copyDraft}>{copied ? "복사됨 ✓" : "복사"}</button>
                        </div>
                      )}
                    </div>

                    {error && <div className="sg-error">{error}</div>}

                    {!entry.draft && !loading && (
                      <div className="sg-empty">
                        <div className="sg-empty-mark">기재</div>
                        <p>활동을 입력하고 <b>생기부 초안 작성</b>을 누르면<br />여기에 초안이 나타납니다.</p>
                      </div>
                    )}
                    {loading && !entry.draft && <div className="sg-empty"><p>{loadingMsg}</p></div>}

                    {entry.draft && (
                      <>
                        <div className="sg-draft-label">본문 — 직접 수정하면 자동 저장되고 바이트 수도 다시 계산됩니다.</div>
                        <textarea className="sg-draft" value={entry.draft} spellCheck={false}
                                  onChange={(e) => patchEntry({ draft: e.target.value })} />
                        {entry.notes && <div className="sg-notes"><span className="sg-notes-tag">검토</span>{entry.notes}</div>}
                        <div className="sg-refine">
                          {REFINEMENTS.map((r) => (
                            <button key={r.key} className="sg-rbtn" onClick={() => refine(r.instr)} disabled={loading}>{r.label}</button>
                          ))}
                        </div>
                        <div className="sg-refine-custom">
                          <input className="sg-input sm" placeholder="직접 수정 요청 입력 (예: 리더십이 드러나도록 보강해줘)"
                                 value={refineText} onChange={(e) => setRefineText(e.target.value)}
                                 onKeyDown={(e) => e.key === "Enter" && submitRefine()} disabled={loading} />
                          <button className="sg-refine-send" onClick={submitRefine} disabled={loading || !refineText.trim()}>
                            {loading ? "처리 중…" : "요청"}
                          </button>
                        </div>
                        <p className="sg-disclaimer">AI가 작성한 초안입니다. 사실 여부·기재 가능 항목을 반드시 교사가 검토·수정한 뒤 사용하세요.</p>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ───────────── 바이트 계산기 모달 ───────────── */}
      {byteOpen && (
        <>
          <div className="sg-overlay" onClick={() => setByteOpen(false)} />
          <div className="sg-keymodal sg-bytemodal">
            <div className="sg-keymodal-title">바이트 계산기</div>
            <p className="sg-keymodal-desc">
              외부에서 작성한 생기부 내용을 붙여넣으면 NEIS 기준 바이트 수를 계산하고, AI로 직접 다듬을 수 있습니다. (한글·한자 3, 영문·숫자·공백·기호 1, 줄바꿈 2바이트)
            </p>

            <div className="sg-byte-cats">
              <span className="sg-byte-cats-label">영역 <small>(AI 수정 기준)</small></span>
              <div className="sg-chips" style={{ marginBottom: 0 }}>
                {CATEGORIES.map((c) => (
                  <button key={c.key} className={"sg-chip" + (c.key === byteCat ? " on" : "")}
                          onClick={() => pickByteCat(c.key)}>{c.short}</button>
                ))}
              </div>
            </div>

            <textarea className="sg-byte-area" placeholder="여기에 생기부 내용을 붙여넣으세요…"
                      value={byteText} onChange={(e) => setByteText(e.target.value)} spellCheck={false} autoFocus />
            <div className="sg-byte-meter">
              <div className="sg-count sg-byte-count">
                <span className={byteOver ? "warn" : "ok"}>{byteBytes}바이트</span>
                <span className="dim"> / {byteTarget}바이트 · {charCount(byteText)}자</span>
                {byteOver && <span className="warn"> · {byteBytes - byteTarget}바이트 초과</span>}
              </div>
              <div className="sg-byte-target">
                <label>기준</label>
                <input className="sg-input sm" type="number" min={0} max={4000} step={50}
                       value={byteTarget} onChange={(e) => setByteTarget(Number(e.target.value) || 0)} />
              </div>
            </div>
            <div className="sg-gauge"><div className={"sg-gauge-fill " + byteGauge} style={{ width: bytePct + "%" }} /></div>

            <div className="sg-byte-ai">
              <div className="sg-byte-ai-label">AI 수정</div>
              <div className="sg-refine" style={{ padding: 0 }}>
                {REFINEMENTS.map((r) => (
                  <button key={r.key} className="sg-rbtn" onClick={() => refineByte(r.instr, "내용을 다듬는 중…")}
                          disabled={byteLoading || !byteText.trim()}>{r.label}</button>
                ))}
              </div>
              <div className="sg-refine-custom" style={{ padding: "10px 0 0" }}>
                <input className="sg-input sm" placeholder="직접 수정 요청 입력 (예: 분량을 1500바이트에 맞춰 줄여줘)"
                       value={byteRefineText} onChange={(e) => setByteRefineText(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && submitByteRefine()} disabled={byteLoading} />
                <button className="sg-refine-send" onClick={submitByteRefine} disabled={byteLoading || !byteRefineText.trim() || !byteText.trim()}>
                  {byteLoading ? "처리 중…" : "요청"}
                </button>
              </div>
              {byteLoading && <p className="sg-byte-status">{byteLoadingMsg || "처리 중…"}</p>}
              {byteNotes && <div className="sg-notes" style={{ margin: "12px 0 0" }}><span className="sg-notes-tag">검토</span>{byteNotes}</div>}
              {byteError && <div className="sg-error" style={{ margin: "12px 0 0" }}>{byteError}</div>}
            </div>

            <div className="sg-keymodal-row">
              <button className="sg-ghost" onClick={() => { setByteText(""); setByteNotes(""); setByteError(""); }}>지우기</button>
              <div className="sg-keymodal-spacer" />
              <button className="sg-addbtn" onClick={() => setByteOpen(false)}>닫기</button>
            </div>
          </div>
        </>
      )}

      {/* ───────────── 초안 이력 모달 ───────────── */}
      {historyOpen && entry && (
        <>
          <div className="sg-overlay" onClick={() => setHistoryOpen(false)} />
          <div className="sg-keymodal sg-histmodal">
            <div className="sg-keymodal-title">초안 이력</div>
            <p className="sg-keymodal-desc">
              AI로 다시 작성·다듬을 때 이전 버전이 자동 저장됩니다. [스냅샷]으로 직접 체크포인트를 남길 수도 있어요. 최근 {MAX_HISTORY}개까지 보관됩니다.
            </p>
            {(!entry.history || entry.history.length === 0) ? (
              <div className="sg-histempty">아직 저장된 이력이 없습니다.</div>
            ) : (
              <div className="sg-histlist">
                {entry.history.map((v) => (
                  <div key={v.id} className="sg-histitem">
                    <div className="sg-histitem-meta">
                      <span>{formatHistDate(v.at)}</span>
                      <span className="dim"> · {neisBytes(v.draft)}바이트{v.label ? ` · ${v.label}` : ""}</span>
                    </div>
                    <div className="sg-histitem-preview">{v.draft.slice(0, 90)}{v.draft.length > 90 ? "…" : ""}</div>
                    <div className="sg-histitem-actions">
                      <button className="sg-ghost" onClick={() => removeVersion(v.id)}>삭제</button>
                      <button className="sg-addbtn" onClick={() => restoreVersion(v)}>이 버전으로 복원</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="sg-keymodal-row">
              <div className="sg-keymodal-spacer" />
              <button className="sg-addbtn" onClick={() => setHistoryOpen(false)}>닫기</button>
            </div>
          </div>
        </>
      )}

      {/* ───────────── 학생 삭제 확인 모달 ───────────── */}
      {delTarget && (
        <>
          <div className="sg-overlay" onClick={() => setDelTarget(null)} />
          <div className="sg-keymodal sg-confirm">
            <div className="sg-keymodal-title">학생을 삭제할까요?</div>
            <p className="sg-keymodal-desc">
              <b>{delTarget.name || "이 학생"}</b> 학생과 작성한 <b>모든 생기부 항목·초안</b>이 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="sg-keymodal-row">
              <div className="sg-keymodal-spacer" />
              <button className="sg-ghost" onClick={() => setDelTarget(null)}>취소</button>
              <button className="sg-dangerbtn" onClick={() => { const id = delTarget.id; setDelTarget(null); deleteStudent(id); }}>삭제</button>
            </div>
          </div>
        </>
      )}

      {/* ───────────── 학생 정보 수정 모달 ───────────── */}
      {editOpen && student && (
        <>
          <div className="sg-overlay" onClick={() => setEditOpen(false)} />
          <div className="sg-keymodal">
            <div className="sg-keymodal-title">학생 정보 수정</div>
            <div className="sg-edit-grid">
              <div className="sg-field span2">
                <label>이름</label>
                <input className="sg-input sm" value={edit.name} autoFocus
                       onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                       onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
              </div>
              <div className="sg-field span2">
                <label>학교</label>
                <input className="sg-input sm" value={edit.school}
                       onChange={(e) => setEdit({ ...edit, school: e.target.value })}
                       onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
              </div>
              <div className="sg-field">
                <label>학년</label>
                <input className="sg-input sm" value={edit.grade}
                       onChange={(e) => setEdit({ ...edit, grade: e.target.value })}
                       onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
              </div>
              <div className="sg-field">
                <label>반</label>
                <input className="sg-input sm" value={edit.klass}
                       onChange={(e) => setEdit({ ...edit, klass: e.target.value })}
                       onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
              </div>
              <div className="sg-field">
                <label>번호</label>
                <input className="sg-input sm" value={edit.number}
                       onChange={(e) => setEdit({ ...edit, number: e.target.value })}
                       onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
              </div>
            </div>
            <p className="sg-edit-hint"><b>과목</b>은 각 세특 항목의 <b>과목</b> 칸에서 항목별로 수정할 수 있어요.</p>
            {error && <div className="sg-error" style={{ marginTop: 12 }}>{error}</div>}
            <div className="sg-keymodal-row">
              <div className="sg-keymodal-spacer" />
              <button className="sg-ghost" onClick={() => setEditOpen(false)}>취소</button>
              <button className="sg-addbtn" onClick={saveEdit} disabled={!edit.name.trim()}>저장</button>
            </div>
          </div>
        </>
      )}

      {/* ───────────── API 키 모달 ───────────── */}
      {keyOpen && (
        <>
          <div className="sg-overlay" onClick={() => setKeyOpen(false)} />
          <div className="sg-keymodal">
            <div className="sg-keymodal-title">AI API 키</div>
            <div className="sg-keymodal-tabs">
              {Object.entries(PROVIDERS).map(([p, info]) => (
                <button key={p} className={"sg-tab" + (keyProvider === p ? " on" : "")}
                        onClick={() => switchKeyTab(p)} type="button">
                  {info.label}{(p === "openai" ? openaiKey : geminiKey) ? " ✓" : ""}
                </button>
              ))}
            </div>
            <p className="sg-keymodal-desc">
              본인 {PROVIDERS[keyProvider].label} API 키를 입력하면 이 기기에서는 해당 키·모델로 생성합니다. 키는 이 브라우저에만 저장되며(localStorage) 서버에 보관되지 않습니다.
            </p>
            <input className="sg-input" type="password" placeholder={PROVIDERS[keyProvider].placeholder} value={keyInput}
                   onChange={(e) => setKeyInput(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && saveKey()} autoFocus />
            <a className="sg-keymodal-link" href={PROVIDERS[keyProvider].linkHref} target="_blank" rel="noopener noreferrer">
              키가 없으신가요? {PROVIDERS[keyProvider].linkLabel}
            </a>
            <div className="sg-keymodal-row">
              {(keyProvider === "openai" ? openaiKey : geminiKey) && <button className="sg-keyclear" onClick={clearKey}>등록 해제</button>}
              <div className="sg-keymodal-spacer" />
              <button className="sg-ghost" onClick={() => setKeyOpen(false)}>취소</button>
              <button className="sg-addbtn" onClick={saveKey}>저장</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
