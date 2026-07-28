/**
 * Переключение раскладки для поиска (FR-2.1).
 *
 * Человек ищет «гречка», забыв переключить клавиатуру, и получает «uhtxrf».
 * Поиск обязан находить продукт в обоих случаях, иначе сценарий S1 ломается
 * ровно там, где важна скорость.
 */

/** Позиционное соответствие клавиш QWERTY → ЙЦУКЕН. */
const QWERTY = `qwertyuiop[]asdfghjkl;'zxcvbnm,.\`QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>~`;
const JCUKEN = `йцукенгшщзхъфывапролджэячсмитьбюёЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮЁ`;

function buildMap(from: string, to: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [index, char] of [...from].entries()) {
    const replacement = [...to][index];
    if (replacement !== undefined) map.set(char, replacement);
  }
  return map;
}

const TO_CYRILLIC = buildMap(QWERTY, JCUKEN);
const TO_LATIN = buildMap(JCUKEN, QWERTY);

function convert(text: string, map: Map<string, string>): string {
  return [...text].map((char) => map.get(char) ?? char).join('');
}

/**
 * Строка в противоположной раскладке. Если переводить нечего — возвращает
 * null, чтобы вызывающий не гонял в базу второй одинаковый запрос.
 */
export function switchLayout(query: string): string | null {
  const hasCyrillic = /[а-яё]/i.test(query);
  const converted = hasCyrillic ? convert(query, TO_LATIN) : convert(query, TO_CYRILLIC);

  return converted === query ? null : converted;
}

/**
 * Варианты запроса для поиска: сам запрос и, если он похож на набранный
 * не в той раскладке, его перевод.
 */
export function queryVariants(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed === '') return [];

  const switched = switchLayout(trimmed);
  return switched === null ? [trimmed] : [trimmed, switched];
}
