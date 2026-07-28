/**
 * Округление до заданного числа знаков.
 *
 * Наивное `Math.round(v * 10 ** d) / 10 ** d` врёт на значениях вроде 1.005
 * из-за двоичного представления: 1.005 * 100 === 100.49999999999999.
 * Экспоненциальная запись обходит промежуточное умножение.
 */
export function roundTo(value: number, digits = 0): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isInteger(digits) || digits < 0 || digits > 15) {
    throw new RangeError(`digits должно быть целым от 0 до 15, получено ${digits}`);
  }

  const [mantissa, exponent = '0'] = value.toExponential().split('e');
  const shifted = Number(`${mantissa}e${Number(exponent) + digits}`);
  const [roundedMantissa, roundedExponent = '0'] = Math.round(shifted).toExponential().split('e');

  return Number(`${roundedMantissa}e${Number(roundedExponent) - digits}`);
}
