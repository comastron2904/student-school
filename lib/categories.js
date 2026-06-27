// 영역 정의 + 공용 헬퍼 (클라이언트/서버 공유)

export const CATEGORIES = [
  { key: "subject",   label: "세부능력 및 특기사항", short: "세특",   needsSubject: true,  target: 1500,
    guide: "교과 수업 안에서의 탐구·발표·과제·토론 등 학습 활동과, 그 과정에서 드러난 교과 역량(지식 이해·적용, 탐구력, 사고력 등)을 중심으로 서술한다." },
  { key: "autonomy",  label: "자율·자치활동",        short: "자율",   target: 1500,
    guide: "학급·학교 단위 활동에서의 역할, 자기주도성, 공동체 의식, 책임감, 의사소통·협력 태도를 중심으로 서술한다." },
  { key: "club",      label: "동아리활동",            short: "동아리", target: 1500,
    guide: "관심 분야에 대한 탐구 과정, 협업과 기여, 자기주도적 활동, 산출물과 그 의미를 중심으로 서술한다." },
  { key: "career",    label: "진로활동",              short: "진로",   target: 2100,
    guide: "진로 탐색·설계 과정, 관심 분야에 대한 이해 심화, 자기 이해와 진로 역량의 성장을 중심으로 서술한다." },
  { key: "volunteer", label: "봉사활동 특기사항",     short: "봉사",   target: 1050,
    guide: "나눔과 배려의 실천, 지속성, 봉사 과정에서 보인 태도와 변화·성장을 중심으로 서술한다." },
  { key: "behavior",  label: "행동특성 및 종합의견",  short: "행특",  target: 1500,
    guide: "인성, 학습 태도, 대인관계, 잠재력 등 1년간의 행동 특성을 종합적으로 관찰자 시점에서 서술한다." },
];

export const REFINEMENTS = [
  { key: "concrete", label: "더 구체적으로", instr: "추상적 표현을 줄이고 활동의 과정·근거가 더 구체적으로 드러나도록 다듬어 주세요." },
  { key: "shorter",  label: "더 간결하게",  instr: "핵심을 유지하면서 더 간결하게 줄여 주세요." },
  { key: "natural",  label: "문장 다듬기",  instr: "나열식 문장을 자연스러운 하나의 흐름으로 매끄럽게 다듬어 주세요." },
  { key: "longer",   label: "분량 늘리기",  instr: "활동의 의미와 역량 서술을 보강해 분량을 자연스럽게 늘려 주세요." },
];

export const catOf = (k) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[0];

export const studentMeta = (s) =>
  [s.grade && s.grade + "학년", s.klass && s.klass + "반", s.number && s.number + "번"]
    .filter(Boolean)
    .join(" ");

// NEIS 바이트: 한글/한자 3, 영문·숫자·공백·특수 1, 줄바꿈 2
export function neisBytes(s = "") {
  let b = 0;
  for (const ch of s) {
    if (ch === "\n" || ch === "\r") b += 2;
    else if (ch.codePointAt(0) > 127) b += 3;
    else b += 1;
  }
  return b;
}

export const charCount = (s = "") => [...s].length;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// 활동 우선순위: 2=높음(중점 서술), 1=보통(기본), 0=낮음(간략)
export const PRIORITIES = [
  { v: 2, label: "높음", emph: "중점 서술", hint: "분량과 비중을 늘려 본문의 중심으로 다룸" },
  { v: 1, label: "보통", emph: "기본",     hint: "보통 비중으로 다룸" },
  { v: 0, label: "낮음", emph: "간략 서술", hint: "핵심만 간략히, 또는 흐름상 생략 가능" },
];
export const prioOf = (v) => PRIORITIES.find((p) => p.v === v) || PRIORITIES[1];

export const newActivity = () => ({ id: uid(), title: "", detail: "", meaning: "", priority: 1 });
