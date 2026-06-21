import "./globals.css";

export const metadata = {
  title: "생활기록부 작성 도우미",
  description: "교사용 생기부 초안 작성 도구",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
