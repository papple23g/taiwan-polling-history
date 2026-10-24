export function pageNumbers(pageCount) {
  const count = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 1;
  return Array.from({ length: count }, (_, index) => index);
}
