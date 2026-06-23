"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CATEGORIES, REFINEMENTS, catOf, studentMeta, neisBytes, charCount, uid, newActivity,
} from "@/lib/categories";

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [add, setAdd] = useState({ name: "", grade: "", klass: "", number: "" });
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState("");          // 기기별 사용자 Gemini 키
  const [keyOpen, setKeyOpen] = useState(false);     // 키 입력 모달
  const [keyInput, setKeyInput] = useState("");      // 모달 임시 입력값
  const searchRef = useRef(null);
  const resultRef = useRef(null);
  const saveTimers = useRef({});

  useEffect(() => { if (open) setTimeout(() => searchRef.current?.focus(), 30); }, [open]);

  // 기기별 저장된 Gemini API 키 불러오기
  useEffect(() => {
    try { setApiKey(localStorage.getItem("gemini_api_key") || ""); } catch {}
  }, []);

  function openKeyModal() { setKeyInput(apiKey); setKeyOpen(true); }
  function saveKey() {
    const v = keyInput.trim();
    try { v ? localStorage.setItem("gemini_api_key", v) : localStorage.removeItem("gemini_api_key"); } catch {}
    setApiKey(v); setKeyOpen(false);
  }
  function clearKey() {
    try { localStorage.removeItem("gemini_api_key"); } catch {}
    setApiKey(""); setKeyInput(""); setKeyOpen(false);
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
    setOpen(false); setQuery("");
  }
  async function addStudent() {
    if (!add.name.trim()) return;
    const { data: srow, error } = await supabase.from("students")
      .insert({ name: add.name.trim(), grade: add.grade.trim(), klass: add.klass.trim(), number: add.number.trim() })
      .select().single();
    if (error || !srow) { setError("학생 추가 실패: " + (error?.message || "")); return; }

    const defActs = [newActivity()];
    const c = catOf("subject");
    const { data: erow } = await supabase.from("entries")
      .insert({ student_id: srow.id, category: "subject", subject: "", activities: defActs, target: c.target, draft: "", notes: "" })
      .select().single();

    const newStudent = { ...srow, entries: erow ? [{ ...erow, activities: defActs }] : [] };
    setStudents((arr) => [...arr, newStudent]);
    setActiveSid(srow.id); setActiveEid(erow?.id || null);
    setAdd({ name: "", grade: "", klass: "", number: "" });
    setOpen(false); setQuery("");
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

  // ── 항목 ──
  async function addEntry() {
    if (!student) return;
    const c = catOf(entry?.category || "subject");
    const defActs = [newActivity()];
    const { data: erow, error } = await supabase.from("entries")
      .insert({ student_id: student.id, category: c.key, subject: "", activities: defActs, target: c.target, draft: "", notes: "" })
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

  const hasContent = entry?.activities.some((a) => a.title.trim() || a.detail.trim());

  // ── AI ──
  async function runGenerate(payload, msg) {
    setError(""); setCopied(false); setLoading(true); setLoadingMsg(msg);
    try {
      const res = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.code === "NO_API_KEY" || data?.code === "BAD_API_KEY") {
          setError(data.error + " · 우측 상단 [API 키]에서 본인 Gemini 키를 등록해 주세요.");
          openKeyModal();
          return;
        }
        if (data?.code === "RATE_LIMIT") { setError("API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."); return; }
        if (data?.code === "GEMINI_BUSY") { setError("Gemini 서버가 잠시 혼잡합니다. 잠시 후 [생성] 버튼을 다시 눌러 주세요."); return; }
        setError("생성 실패: " + (data?.detail || data?.error || "알 수 없는 오류"));
        return;
      }
      patchEntry({ draft: data.draft || "", notes: data.notes || "" });
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e) {
      setError("생성 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally { setLoading(false); }
  }
  const generate = () => runGenerate(
    { mode: "generate", category: entry.category, subject: entry.subject, target: entry.target, activities: entry.activities },
    "활동 기록을 검토하는 중…"
  );
  const refine = (instruction) => entry.draft.trim() && runGenerate(
    { mode: "refine", category: entry.category, subject: entry.subject, target: entry.target, draft: entry.draft, instruction },
    "초안을 다듬는 중…"
  );

  function copyDraft() {
    navigator.clipboard?.writeText(entry.draft).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }
  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login"); router.refresh();
  }

  const filtered = students.filter((s) => !query.trim() || s.name.includes(query.trim()));
  const bytes = entry ? neisBytes(entry.draft) : 0;
  const over = entry ? bytes > entry.target : false;

  return (
    <div className="sg-root">
      <header className="sg-header">
        <div className="sg-top">
          <div className="sg-wordmark">생활기록부 작성 도우미</div>
          <div className="sg-headright">
            <span className={"sg-save sg-save-" + saveState}>
              {saveState === "saving" ? "저장 중…" : saveState === "saved" ? "저장됨 ✓" : ""}
            </span>
            <span className="sg-user">{userEmail}</span>
            <button className={"sg-keybtn" + (apiKey ? " on" : "")} onClick={openKeyModal} title={apiKey ? "내 API 키 사용 중" : "API 키 미등록 (서버 기본키 사용)"}>
              API 키{apiKey ? " ✓" : ""}
            </button>
            <button className="sg-signout" onClick={signOut}>로그아웃</button>
          </div>
        </div>
        <p className="sg-sub">학생 활동을 항목별로 입력하면 기재요령에 맞는 초안을 만들어 드립니다 · 교사용</p>
      </header>

      {keyOpen && (
        <>
          <div className="sg-overlay" style={{ zIndex: 60, background: "rgba(20,30,35,.32)" }} onClick={() => setKeyOpen(false)} />
          <div className="sg-keymodal">
            <div className="sg-keymodal-title">Gemini API 키</div>
            <p className="sg-keymodal-desc">
              본인 Gemini API 키를 입력하면 이 기기에서는 해당 키로 생성합니다. 키는 이 브라우저에만 저장되며(localStorage) 서버에 보관되지 않습니다.
            </p>
            <input
              className="sg-input" type="password" placeholder="AIza..." value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveKey()} autoFocus
            />
            <a className="sg-keymodal-link" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">
              키가 없으신가요? Google AI Studio에서 무료로 발급받기 ↗
            </a>
            <div className="sg-keymodal-row">
              {apiKey && <button className="sg-keyclear" onClick={clearKey}>등록 해제</button>}
              <div className="sg-keymodal-spacer" />
              <button className="sg-signout" onClick={() => setKeyOpen(false)}>취소</button>
              <button className="sg-addbtn" onClick={saveKey}>저장</button>
            </div>
          </div>
        </>
      )}

      <div className="sg-shell">
        {/* 학생 선택 드롭다운 */}
        <div className="sg-selectbar">
          <div className="sg-combo">
            <button className={"sg-trigger" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)}>
              {student ? (
                <span className="sg-trigger-label">
                  <span className="sg-trigger-name">{student.name}</span>
                  {studentMeta(student) && <span className="sg-trigger-meta">{studentMeta(student)}</span>}
                </span>
              ) : (<span className="sg-trigger-ph">학생을 선택하세요</span>)}
              <span className="sg-caret">▾</span>
            </button>

            {open && (
              <>
                <div className="sg-overlay" onClick={() => setOpen(false)} />
                <div className="sg-panel">
                  <input ref={searchRef} className="sg-search" placeholder="이름 검색"
                         value={query} onChange={(e) => setQuery(e.target.value)}
                         onKeyDown={(e) => e.key === "Escape" && setOpen(false)} />
                  <div className="sg-list">
                    {filtered.map((s) => (
                      <div key={s.id} className={"sg-item" + (s.id === activeSid ? " on" : "")} onClick={() => selectStudent(s.id)}>
                        <div className="sg-item-main">
                          <div className="sg-item-name">{s.name}</div>
                          <div className="sg-item-meta">{studentMeta(s) || "정보 없음"} · {s.entries.length}개 항목</div>
                        </div>
                        <button className="sg-item-x" onClick={(e) => { e.stopPropagation(); deleteStudent(s.id); }} aria-label="삭제">✕</button>
                      </div>
                    ))}
                    {filtered.length === 0 && <div className="sg-list-empty">{students.length ? "검색 결과 없음" : "아래에서 학생을 추가하세요"}</div>}
                  </div>
                  <div className="sg-addbox">
                    <div className="sg-addbox-title">+ 새 학생</div>
                    <input className="sg-input sm" placeholder="이름" value={add.name}
                           onChange={(e) => setAdd({ ...add, name: e.target.value })}
                           onKeyDown={(e) => e.key === "Enter" && addStudent()} />
                    <div className="sg-add-row">
                      <input className="sg-input sm" placeholder="학년" value={add.grade} onChange={(e) => setAdd({ ...add, grade: e.target.value })} />
                      <input className="sg-input sm" placeholder="반" value={add.klass} onChange={(e) => setAdd({ ...add, klass: e.target.value })} />
                      <input className="sg-input sm" placeholder="번호" value={add.number} onChange={(e) => setAdd({ ...add, number: e.target.value })} />
                      <button className="sg-addbtn" onClick={addStudent} disabled={!add.name.trim()}>추가</button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="sg-count-chip">{students.length}명</div>
        </div>

        {/* 메인 */}
        <main className="sg-main">
          {!student ? (
            <div className="sg-blank">
              <div className="sg-blank-mark">명단</div>
              <p>위 선택창에서 학생을 추가하면<br />학생별 생기부 작성을 시작할 수 있습니다.</p>
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
                <button className="sg-tab add" onClick={addEntry}>+ 새 항목</button>
              </div>

              {entry && (
                <>
                  <div className="sg-card">
                    <div className="sg-eyebrow">01 · 영역 / 분량</div>
                    <div className="sg-chips">
                      {CATEGORIES.map((c) => (
                        <button key={c.key} className={"sg-chip" + (c.key === entry.category ? " on" : "")}
                                onClick={() => patchEntry({ category: c.key })}>{c.label}</button>
                      ))}
                    </div>
                    <div className="sg-row">
                      {cat.needsSubject && (
                        <div className="sg-field" style={{ flex: 1 }}>
                          <label>과목</label>
                          <input className="sg-input" placeholder="예) 통합과학, 문학, 미적분"
                                 value={entry.subject || ""} onChange={(e) => patchEntry({ subject: e.target.value })} />
                        </div>
                      )}
                      <div className="sg-field" style={{ width: 150 }}>
                        <label>목표 바이트</label>
                        <input className="sg-input" type="number" min={300} max={4000} step={50}
                               value={entry.target} onChange={(e) => patchEntry({ target: Number(e.target.value) || 0 })} />
                      </div>
                    </div>
                  </div>

                  <div className="sg-card">
                    <div className="sg-eyebrow">02 · 활동 기록</div>
                    <p className="sg-help"><b>한 일/관찰</b>은 사실 위주로, <b>의미/성장</b>은 드러난 역량이나 변화를 적으면 초안 품질이 좋아집니다.</p>
                    <div className="sg-acts">
                      {entry.activities.map((a, i) => (
                        <div className="sg-act" key={a.id}>
                          <div className="sg-act-head">
                            <span className="sg-act-no">{String(i + 1).padStart(2, "0")}</span>
                            <input className="sg-act-title" placeholder="활동 제목 (예: 환경 캠페인 기획)"
                                   value={a.title} onChange={(e) => updateActivity(a.id, "title", e.target.value)} />
                            <button className="sg-del" onClick={() => removeActivity(a.id)} disabled={entry.activities.length === 1} aria-label="삭제">✕</button>
                          </div>
                          <textarea className="sg-area" rows={2} placeholder="한 일 / 관찰한 내용 — 무엇을, 어떻게 했는지"
                                    value={a.detail} onChange={(e) => updateActivity(a.id, "detail", e.target.value)} />
                          <textarea className="sg-area" rows={2} placeholder="의미 / 성장 — 드러난 역량, 태도, 변화 (선택)"
                                    value={a.meaning} onChange={(e) => updateActivity(a.id, "meaning", e.target.value)} />
                        </div>
                      ))}
                    </div>
                    <button className="sg-addact" onClick={addActivity}>+ 활동 추가</button>
                  </div>

                  <button className="sg-generate" onClick={generate} disabled={!hasContent || loading}>
                    {loading ? loadingMsg : "생기부 초안 작성"}
                  </button>
                  {!hasContent && <p className="sg-hint">활동을 한 개 이상 입력하면 작성할 수 있어요.</p>}

                  <div className="sg-card sg-result" ref={resultRef}>
                    <div className="sg-result-top">
                      <div>
                        <div className="sg-eyebrow">초안 · {cat.label}{cat.needsSubject && entry.subject ? ` · ${entry.subject}` : ""}</div>
                        {entry.draft && (
                          <div className="sg-count">
                            <span className={over ? "warn" : "ok"}>{bytes}바이트</span>
                            <span className="dim"> / {entry.target}바이트 · {charCount(entry.draft)}자</span>
                            {over && <span className="warn"> · 초과</span>}
                          </div>
                        )}
                      </div>
                      {entry.draft && <button className="sg-copy" onClick={copyDraft}>{copied ? "복사됨 ✓" : "복사"}</button>}
                    </div>

                    {error && <div className="sg-error">{error}</div>}

                    {!entry.draft && !loading && (
                      <div className="sg-empty">
                        <div className="sg-empty-mark">기재</div>
                        <p>활동을 입력하고 <b>초안 작성</b>을 누르면<br />여기에 생기부 초안이 나타납니다.</p>
                      </div>
                    )}
                    {loading && !entry.draft && <div className="sg-empty"><p>{loadingMsg}</p></div>}

                    {entry.draft && (
                      <>
                        <textarea className="sg-draft" value={entry.draft} spellCheck={false}
                                  onChange={(e) => patchEntry({ draft: e.target.value })} />
                        {entry.notes && <div className="sg-notes"><span className="sg-notes-tag">검토</span> {entry.notes}</div>}
                        <div className="sg-refine">
                          {REFINEMENTS.map((r) => (
                            <button key={r.key} className="sg-rbtn" onClick={() => refine(r.instr)} disabled={loading}>{r.label}</button>
                          ))}
                        </div>
                        <p className="sg-disclaimer">AI가 작성한 초안입니다. 사실 여부·기재 가능 항목을 반드시 교사가 검토·수정한 뒤 사용하세요.</p>
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
