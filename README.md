# 생활기록부 작성 도우미 (교사용)

학생 활동을 항목별로 입력하면 AI가 학교생활기록부 기재요령에 맞는 초안을 작성해 주는 교사용 웹앱입니다.
로그인 기반이며, **각 선생님은 본인이 만든 학생·초안만** 볼 수 있습니다(Supabase Auth + RLS).

- Next.js (App Router) + Supabase + Vercel
- 영역: 세특 / 자율 / 동아리 / 진로 / 봉사 / 행특
- NEIS 바이트 기준 분량 표시(한글 3 / 영문·숫자·공백 1 / 줄바꿈 2)
- AI 키는 **서버에서만** 사용 → 브라우저에 노출되지 않음

---

## 1. Supabase 설정

1. [supabase.com](https://supabase.com) 에서 프로젝트 생성
2. **SQL Editor** 에 `supabase/schema.sql` 전체를 붙여넣고 실행 (테이블 + RLS 생성)
3. **Project Settings → API** 에서 아래 두 값 복사
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. (편의) **Authentication → Sign In / Providers → Email** 에서
   "Confirm email" 을 끄면 가입 즉시 로그인됩니다. 켜두면 확인 메일 링크를 눌러야 합니다.

## 2. AI 키 (Gemini / ChatGPT)

두 제공자 중 하나(또는 둘 다)를 설정할 수 있습니다. 교사는 앱 좌측 하단 [API 키]에서 제공자를 선택하고
본인 키를 등록하면 그 키·모델로 생성합니다(브라우저 localStorage에만 저장, 서버 미보관).
등록하지 않으면 아래 서버 환경변수로 폴백합니다.

- **Gemini**: [Google AI Studio](https://aistudio.google.com/app/apikey) 에서 키 발급 (무료 등급 가능) →
  `GEMINI_API_KEY`. 모델은 기본 `gemini-2.5-flash` (`GEMINI_MODEL` 로 변경 가능).
- **ChatGPT(OpenAI)**: [OpenAI Platform](https://platform.openai.com/api-keys) 에서 키 발급 →
  `OPENAI_API_KEY`. 모델은 기본 `gpt-4o-mini` (`OPENAI_MODEL` 로 변경 가능).

## 3. 로컬 실행

```bash
cp .env.local.example .env.local   # 값 채우기
npm install
npm run dev                        # http://localhost:3000
```

## 4. GitHub → Vercel 배포

1. 이 폴더를 GitHub 저장소로 push
2. [Vercel](https://vercel.com) 에서 해당 저장소 Import
3. **Environment Variables** 에 등록 (AI 키는 필요한 제공자만 등록해도 됨 — 교사가 본인 키를 등록하면 그걸 우선 사용):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`
4. Deploy

> ⚠️ `NEXT_PUBLIC_*` 는 브라우저에 노출되지만 anon 키는 RLS로 보호되어 안전합니다.
> `GEMINI_API_KEY`/`OPENAI_API_KEY` 는 `NEXT_PUBLIC_` 접두사가 없어 서버에서만 쓰이며 노출되지 않습니다.

---

## 구조

```
app/
  login/page.js        로그인·회원가입
  app/page.js          보호 페이지(서버: 인증 확인 + 데이터 로드)
  app/Workspace.jsx    메인 UI(학생 드롭다운/항목 탭/작성/결과)
  api/generate/route.js  서버 측 AI 호출(Gemini/ChatGPT, 키 비노출)
lib/
  supabase/{client,server,middleware}.js
  categories.js        영역 정의·바이트 계산 등 공용
middleware.js          세션 갱신 + 보호 경로 리다이렉트
supabase/schema.sql    테이블 + RLS
```

## 데이터 모델

- `students(id, owner_id, name, grade, klass, number, created_at)`
- `entries(id, owner_id, student_id, category, subject, activities(jsonb), target, draft, notes, updated_at)`

`owner_id` 는 `auth.uid()` 가 기본값이며, RLS 정책이 `owner_id = auth.uid()` 인 행만 허용합니다.

## 메모

- 초안은 AI 보조 결과입니다. 사실 여부·기재 가능 항목은 반드시 교사가 검토 후 사용하세요.
- 바이트 계산은 일반적인 NEIS 규칙으로 구현했습니다. 실제 NEIS 화면 카운트와 한 번 대조해 보시고,
  차이가 있으면 `lib/categories.js` 의 `neisBytes` 만 조정하면 됩니다.
- AI 제공자는 Gemini/ChatGPT 중 앱에서 선택할 수 있습니다. 다른 제공자를 추가하려면
  `app/api/generate/route.js` 에 `callXxx` 함수를 만들고 `callAI` 디스패처에 분기를 추가하세요.
