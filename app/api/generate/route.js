// 서버 측 AI 생성 라우트 — AI 키는 여기서만 사용(브라우저 비노출). Gemini / ChatGPT(OpenAI) 지원
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { catOf, prioOf } from "@/lib/categories";

function buildSystem(cat, subject, target) {
  return `당신은 대한민국 고등학교 학교생활기록부(생기부) 작성을 돕는 전문 보조자입니다. 교사가 입력한 학생 활동 관찰 기록을 바탕으로 교육부 학교생활기록부 기재요령에 부합하는 '${cat.label}'${cat.needsSubject && subject ? ` (과목: ${subject})` : ""} 초안을 작성합니다.

[문체 규칙]
- 명사형 종결('~함', '~음', '~을 보임', '~을 기름' 등)으로 종결한다.
- 학생 이름이나 '나' 등 주어를 쓰지 않는다. 1인칭·구어체·감상문체 금지.
- 관찰 가능한 사실과 구체적 행동을 중심으로, 활동 → 노력·과정 → 역량·성장의 흐름으로 연결한다.
- 추상적 미사여구·과장을 피하고 담백하고 구체적으로 쓴다.
- 여러 활동을 자연스러운 하나의 흐름으로 엮되 단순 나열이 되지 않게 한다.

[영역 관점]
${cat.guide}

[활동별 비중 — 우선순위]
- 일부 활동에는 우선순위가 표시될 수 있다.
- '우선순위: 높음'으로 표시된 활동은 분량과 서술의 비중을 늘려 본문의 중심으로 구체적으로 다룬다.
- '우선순위: 낮음'으로 표시된 활동은 핵심만 간략히 보조적으로 언급하며, 전체 흐름상 자연스럽지 않으면 생략해도 된다.
- 표시가 없는 활동은 보통 비중으로 다룬다.
- 단, 우선순위에 따른 비중 조절이 글의 자연스러움을 해치지 않도록 전체를 하나의 매끄러운 흐름으로 엮는다.

[반드시 제외할 항목 — 기재 금지]
- 특정 대상을 식별할 수 있는 고유명사 전체: 대학명(예: OO대학교), 기관·단체·업체명(상호명), 학원명, 강사·강연자·교수 등 특정 인물의 실명, 교외 기관·대회명
- 교외 수상 실적, 어학시험·인증시험 점수/급수, 모의고사·교내외 시험 성적
- 부모/친인척의 사회·경제적 지위, 특정 상품명·브랜드명
- 논문 등재, 발명·특허 등 미기재 항목
입력에 이런 내용이 있으면 그 대상을 특정하는 이름은 절대 본문에 쓰지 않는다. 가능하면 "지역 전문가", "외부 강사", "관련 기관", "인근 대학" 처럼 대상이 특정되지 않는 일반화된 표현으로 자연스럽게 바꿔 서술하고, 자연스럽게 녹이기 어려우면 그 부분만 생략한다. 무엇을 제외했거나 어떻게 일반화했는지 notes에 간단히 알린다.

[분량] 권장 분량은 한글 약 ${Math.round(target / 3)}자 내외이다. 분량에 억지로 맞추려 하지 말고 활동 내용을 충실하고 자연스럽게 서술하되, 위 권장 글자수를 대략적인 기준으로만 참고한다.

반드시 JSON 형식으로만 출력한다: {"draft": "<생기부 본문>", "notes": "<교사 검토 포인트나 제외한 내용을 1~2문장으로. 없으면 빈 문자열>"}`;
}

function buildUser(cat, activities) {
  const lines = (activities || [])
    .filter((a) => a.title?.trim() || a.detail?.trim() || a.meaning?.trim())
    .map((a, i) => {
      const pr = prioOf(a.priority ?? 1);
      const tag = pr.v === 1 ? "" : ` [우선순위: ${pr.label} — ${pr.emph}]`;
      const p = [`활동 ${i + 1}: ${a.title || "(제목 없음)"}${tag}`];
      if (a.detail?.trim()) p.push(`  - 한 일/관찰: ${a.detail.trim()}`);
      if (a.meaning?.trim()) p.push(`  - 의미/성장: ${a.meaning.trim()}`);
      return p.join("\n");
    })
    .join("\n\n");
  return `다음은 한 학생의 활동 관찰 기록입니다.\n\n${lines}\n\n위 내용을 종합해 '${cat.label}' 초안을 작성해 주세요.`;
}

async function callGemini(systemText, userText, apiKey) {
  // 사용자가 입력한 키 우선, 없으면 서버 환경변수로 폴백
  const key = (apiKey || "").trim() || process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!key) throw new Error("NO_API_KEY");

  // thinking 토큰이 maxOutputTokens를 잠식해 응답이 잘리는 문제 방지.
  // Gemini 2.5 계열은 thinkingBudget:0으로 비활성화, 3.x 계열은 thinkingLevel 사용.
  const thinkingConfig = model.startsWith("gemini-3")
    ? { thinkingLevel: "low" }
    : { thinkingBudget: 0 };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      thinkingConfig,
    },
  });

  // 일시적 서버 오류(5xx)·네트워크 오류일 때만 1회 재시도. 키/요청 오류는 즉시 중단.
  let res, lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 + Math.random() * 600));
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: payload,
      });
    } catch (e) {
      lastErr = e; res = null; continue; // 네트워크 오류 → 재시도
    }
    if (res.ok) break;
    if (res.status >= 500) { lastErr = new Error(`Gemini ${res.status}`); continue; } // 서버 일시오류 → 재시도

    // 4xx: 재시도 의미 없음 — 원인별 분기
    const t = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if ((res.status === 400 || res.status === 401 || res.status === 403) &&
        /API_?KEY|api key|PERMISSION_DENIED|credential/i.test(t)) throw new Error("BAD_API_KEY");
    throw new Error(`Gemini ${res.status} ${t.slice(0, 200)}`);
  }
  if (!res || !res.ok) throw new Error("GEMINI_BUSY"); // 재시도 후에도 실패

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return text;
}

async function callOpenAI(systemText, userText, apiKey) {
  // 사용자가 입력한 키 우선, 없으면 서버 환경변수로 폴백
  const key = (apiKey || "").trim() || process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!key) throw new Error("NO_API_KEY");

  const url = "https://api.openai.com/v1/chat/completions";
  const payload = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userText },
    ],
    temperature: 0.7,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  // 일시적 서버 오류(5xx)·네트워크 오류일 때만 1회 재시도. 키/요청 오류는 즉시 중단.
  let res, lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 + Math.random() * 600));
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: payload,
      });
    } catch (e) {
      lastErr = e; res = null; continue; // 네트워크 오류 → 재시도
    }
    if (res.ok) break;
    if (res.status >= 500) { lastErr = new Error(`OpenAI ${res.status}`); continue; } // 서버 일시오류 → 재시도

    // 4xx: 재시도 의미 없음 — 원인별 분기
    const t = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status === 401 || res.status === 403) throw new Error("BAD_API_KEY");
    throw new Error(`OpenAI ${res.status} ${t.slice(0, 200)}`);
  }
  if (!res || !res.ok) throw new Error("AI_BUSY"); // 재시도 후에도 실패

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callAI(provider, systemText, userText, apiKey) {
  if (provider === "openai") return callOpenAI(systemText, userText, apiKey);
  return callGemini(systemText, userText, apiKey);
}

function parseResult(text) {
  const clean = (text || "").replace(/```json|```/g, "").trim();

  // 1) 정상 JSON
  try {
    const o = JSON.parse(clean);
    return { draft: o.draft || "", notes: o.notes || "" };
  } catch {}

  // 2) 잘린/깨진 JSON에서 draft·notes 문자열만 복구
  const grab = (re) => {
    const m = clean.match(re);
    if (!m) return null;
    try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1]; }
  };
  let draft =
    grab(/"draft"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"notes"/) ?? // notes 앞까지
    grab(/"draft"\s*:\s*"((?:[^"\\]|\\.)*)"/) ??               // 닫는 따옴표 있음
    grab(/"draft"\s*:\s*"((?:[^"\\]|\\.)*)$/);                 // 따옴표 없이 잘림
  if (draft != null) {
    const notes = grab(/"notes"\s*:\s*"((?:[^"\\]|\\.)*)"/) || "";
    return { draft, notes };
  }

  // 3) 최후: 원문 그대로
  return { draft: clean, notes: "" };
}

export async function POST(request) {
  // 로그인 사용자만 호출 허용
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "잘못된 요청" }, { status: 400 }); }

  const {
    category, subject = "", target = 1500, activities = [], mode = "generate",
    draft = "", instruction = "", apiKey = "", provider: providerRaw = "gemini",
  } = body;
  const cat = catOf(category);
  const provider = providerRaw === "openai" ? "openai" : "gemini";
  const providerLabel = provider === "openai" ? "ChatGPT" : "Gemini";

  try {
    let systemText = buildSystem(cat, subject, target);
    let userText;
    if (mode === "refine") {
      userText = `다음은 작성된 '${cat.label}' 초안입니다.\n\n"""${draft}"""\n\n[요청] ${instruction}\n같은 JSON 형식으로만 출력해 주세요.`;
    } else {
      userText = buildUser(cat, activities);
    }
    const text = await callAI(provider, systemText, userText, apiKey);
    return NextResponse.json(parseResult(text));
  } catch (e) {
    const m = String(e?.message || e);
    if (m === "NO_API_KEY")  return NextResponse.json({ error: `${providerLabel} API 키가 필요합니다`, code: "NO_API_KEY" }, { status: 400 });
    if (m === "BAD_API_KEY") return NextResponse.json({ error: `${providerLabel} API 키가 올바르지 않습니다`, code: "BAD_API_KEY" }, { status: 400 });
    if (m === "RATE_LIMIT")  return NextResponse.json({ error: "사용량 한도 초과", code: "RATE_LIMIT" }, { status: 429 });
    if (m === "AI_BUSY")     return NextResponse.json({ error: `${providerLabel} 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해 주세요.`, code: "AI_BUSY" }, { status: 503 });
    return NextResponse.json({ error: "생성 실패", code: "UNKNOWN", detail: m }, { status: 500 });
  }
}
