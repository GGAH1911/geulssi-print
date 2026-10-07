// 던전 모험 게임 낱말 목록.
// fetch() 로 JSON 을 읽으면 file:// 로 열 때 브라우저가 막으므로, 전역 변수에 넣는 스크립트로 둔다.
// 새 몬스터·아이템이 생기면 GGAH1911/new-game 의 README.md 와 src/ 를 보고 아래에 한 줄 추가한다.
//   word: 쓸 낱말 (띄어쓰기 없이)
//   pic : assets/pics/ 안의 그림 파일 이름 (없으면 아이가 그림 칸에 직접 그린다)
//   from: 게임 어디에 나오는지 (아빠 참고용)
window.WORDS = window.WORDS || {};
window.WORDS.game = [
  // 핸드오프에서 정한 첫 낱말 (2026-10-07)
  { word: '칼',       from: '무기' },
  { word: '활',       from: '무기' },
  { word: '좀비',     from: '이끼 동굴 몬스터' },
  { word: '거미',     from: '이끼 동굴 몬스터' },
  { word: '에메랄드', from: '돈(화폐)' },
  { word: '물약',     from: '아이템' },
  { word: '보물상자', from: '던전 상자' },
  { word: '대장장이', from: '캠프 사람' },
  { word: '상인',     from: '캠프 사람' },
  { word: '강아지',   from: '캠프' },
  { word: '허수아비', from: '캠프 연습장' },
  // 게임 README(2026-10-07)에서 더 가져온 낱말
  { word: '박쥐',     from: '해골 무덤 몬스터' },
  { word: '해골',     from: '해골 궁수·해골 기사' },
  { word: '미라',     from: '사막 신전 몬스터' },
  { word: '슬라임',   from: '슬라임 정글 몬스터' },
  { word: '펑펑이',   from: '슬라임 정글 몬스터' },
  { word: '골렘',     from: '용암 요새 몬스터' },
  { word: '마법사',   from: '얼음 성채 몬스터' },
  { word: '화살',     from: '활 아이템' },
  { word: '단검',     from: '무기' },
  { word: '도끼',     from: '무기' },
  { word: '망치',     from: '무기' },
  { word: '갑옷',     from: '장비' },
  { word: '우물',     from: '캠프 소원 우물' },
  { word: '사과',     from: '회복 아이템' },
];
