const pricing = {
  "One-on-One": {
    1: 380,
    4: 1520,
    8: 3040,
    12: 4200,
    16: 5600
  },
  Group: {
    1: 250,
    4: 1000,
    8: 2000,
    12: 3000,
    16: 4000
  }
};

export function packagePrice(sessionType, sessionsTotal) {
  return pricing[sessionType]?.[sessionsTotal] ?? 0;
}

