/**
 * 格式化金额
 * @param value 金额值
 * @param precision 小数位数
 */
export function formatMoney(value: number | string, precision = 2): string {
  if (!value) return '0.00';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return num.toFixed(precision).replace(/\d(?=(\d{3})+\.)/g, '$&,');
}

/**
 * 格式化日期
 * @param date 日期
 * @param format 格式
 */
export function formatDate(date: Date | string | number, format = 'YYYY-MM-DD HH:mm:ss'): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/**
 * 下载文件
 * @param url 文件地址
 * @param filename 文件名
 */
export function downloadFile(url: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = url;
  if (filename) {
    a.download = filename;
  }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 获取 URL 参数
 * @param name 参数名
 */
export function getQueryString(name: string): string | null {
  const reg = new RegExp('(^|&)' + name + '=([^&]*)(&|$)', 'i');
  const r = window.location.search.substr(1).match(reg);
  if (r !== null && r !== undefined) {
    return decodeURIComponent(r[2]);
  }
  return null;
}
