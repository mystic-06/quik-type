// The server's own scoring. A client sends what it typed, never a score, so a score cannot be invented.

/**
 * @param {{ typed: string, text: string, elapsedMs: number }} input
 * Same formulas the typing screen shows: 5 characters make a word, WPM counts only correct characters.
 */
function scoreTyping({ typed, text, elapsedMs }) {
  const entered = typed.slice(0, text.length);
  let correct = 0;
  for (let i = 0; i < entered.length; i++) {
    if (entered[i] === text[i]) correct++;
  }

  const typedCount = entered.length;
  if (typedCount === 0) {
    return { wpm: 0, rawWpm: 0, accuracy: 0, charactersTyped: 0, completionPercentage: 0 };
  }

  const minutes = Math.max(elapsedMs / 60000, 0.05);
  return {
    wpm: Math.round(correct / 5 / minutes),
    rawWpm: Math.round(typedCount / 5 / minutes),
    accuracy: Math.round((correct / typedCount) * 1000) / 10,
    charactersTyped: typedCount,
    completionPercentage: Math.round((typedCount / text.length) * 100),
  };
}

module.exports = { scoreTyping };
