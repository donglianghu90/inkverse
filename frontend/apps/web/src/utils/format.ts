import dayjs from 'dayjs';

/**
 * 格式化日期
 */
export function formatDate(date: string | Date | null | undefined, format = 'YYYY-MM-DD'): string {
  if (!date) return '-';
  return dayjs(date).format(format);
}

/**
 * 格式化日期时间
 */
export function formatDateTime(
  date: string | Date | null | undefined,
  format = 'YYYY-MM-DD HH:mm:ss',
): string {
  if (!date) return '-';
  return dayjs(date).format(format);
}

/**
 * 格式化数字（带千分位，不带货币符号）
 * 用于 Statistic 组件，配合 prefix="¥" 使用
 */
export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || isNaN(Number(value))) return '0.00';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * 格式化金额（带千分位和货币符号）
 * 用于普通文本显示
 */
export function formatMoney(amount: number | null | undefined, decimals = 2): string {
  if (amount === null || amount === undefined) return '-';
  return `¥${Number(amount).toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * 格式化重量（吨）
 */
export function formatWeight(weight: number | null | undefined, decimals = 3): string {
  if (weight === null || weight === undefined) return '-';
  return `${Number(weight).toFixed(decimals)}吨`;
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '-';
  return `${Number(value).toFixed(decimals)}%`;
}

/**
 * 计算偏差
 */
export function calculateDeviation(
  actual: number,
  expected: number,
): {
  value: number;
  percent: number;
  isNormal: boolean;
} {
  const actualNum = Number(actual);
  const expectedNum = Number(expected);
  const deviation = actualNum - expectedNum;
  const percent = (deviation / expectedNum) * 100;
  const isNormal = Math.abs(percent) <= 10; // 偏差在±10%内为正常

  return { value: deviation, percent, isNormal };
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === 0) return '0 B';

  const bytesNum = Number(bytes);
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytesNum) / Math.log(k));

  return `${parseFloat((bytesNum / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * 格式化手机号（隐藏中间4位）
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '-';
  if (phone.length === 11) {
    return `${phone.substr(0, 3)}****${phone.substr(7)}`;
  }
  return phone;
}

/**
 * 计算时间差（返回友好的文本）
 */
export function getTimeDiff(startTime: string | Date, endTime?: string | Date): string {
  const start = dayjs(startTime);
  const end = endTime ? dayjs(endTime) : dayjs();

  const diffMinutes = end.diff(start, 'minute');
  const diffHours = end.diff(start, 'hour');
  const diffDays = end.diff(start, 'day');

  if (diffMinutes < 60) {
    return `${diffMinutes}分钟`;
  }
  if (diffHours < 24) {
    return `${diffHours}小时`;
  }
  return `${diffDays}天`;
}

/**
 * 格式化订单编号（添加前缀）
 */
export function formatOrderNo(orderNo: string | null | undefined): string {
  if (!orderNo) return '-';
  // 如果订单号已经有前缀，直接返回
  if (orderNo.startsWith('ORD') || orderNo.startsWith('202')) {
    return orderNo;
  }
  return `ORD${orderNo}`;
}

/**
 * 获取紧急程度显示文本
 */
export function getUrgencyText(level: string): string {
  const map: Record<string, string> = {
    normal: '普通',
    urgent: '紧急',
    emergency: '特急',
  };
  return map[level] || level;
}

/**
 * 获取紧急程度颜色
 */
export function getUrgencyColor(level: string): string {
  const map: Record<string, string> = {
    normal: '#52c41a',
    urgent: '#faad14',
    emergency: '#f5222d',
  };
  return map[level] || '#999';
}
