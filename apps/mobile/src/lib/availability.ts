export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export const DISPLAY_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export type Weekday = (typeof WEEKDAYS)[number];
export type TimeBlock = { start: string; end: string };
export type WeeklyAvailability = Record<Weekday, TimeBlock[]>;

export const buildEmptyAvailability = (): WeeklyAvailability =>
  WEEKDAYS.reduce((acc, day) => {
    acc[day] = [];
    return acc;
  }, {} as WeeklyAvailability);

export const normalizeAvailability = (availability: any): WeeklyAvailability => {
  const next = buildEmptyAvailability();

  WEEKDAYS.forEach((day) => {
    const blocks = Array.isArray(availability?.[day]) ? availability[day] : [];
    next[day] = blocks
      .map((block: any) => ({
        start: typeof block?.start === 'string' ? block.start : '19:00',
        end: typeof block?.end === 'string' ? block.end : '21:00',
      }))
      .filter((block: TimeBlock) => /^\d{2}:\d{2}$/.test(block.start) && /^\d{2}:\d{2}$/.test(block.end));
  });

  return next;
};

export const timeToMinutes = (value: string) => {
  const [hours = '0', minutes = '0'] = value.split(':');
  return parseInt(hours, 10) * 60 + parseInt(minutes, 10);
};

export const minutesToTime = (totalMinutes: number) => {
  const safeMinutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

export const sortBlocks = (blocks: TimeBlock[]) =>
  [...blocks].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

export const timeStringToDate = (value: string) => {
  const date = new Date();
  const [hours = '0', minutes = '0'] = value.split(':');
  date.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
  return date;
};

export const formatTimeValue = (value: Date) =>
  `${value.getHours().toString().padStart(2, '0')}:${value.getMinutes().toString().padStart(2, '0')}`;

export const formatTimeLabel = (value: string) =>
  timeStringToDate(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const summarizeBlocks = (blocks: TimeBlock[]) => {
  const sortedBlocks = sortBlocks(blocks);
  if (sortedBlocks.length === 0) {
    return 'Off';
  }
  if (sortedBlocks.length === 1) {
    return `${sortedBlocks[0].start}-${sortedBlocks[0].end}`;
  }
  return `${sortedBlocks.length} blocks`;
};

export const getDefaultBlock = (blocks: TimeBlock[]): TimeBlock => {
  if (blocks.length === 0) {
    return { start: '19:00', end: '21:00' };
  }

  const sortedBlocks = sortBlocks(blocks);
  const lastBlock = sortedBlocks[sortedBlocks.length - 1];
  const proposedStart = timeToMinutes(lastBlock.end) + 30;
  const start = proposedStart >= 22 * 60 ? 19 * 60 : proposedStart;
  const end = Math.min(start + 90, 23 * 60 + 30);

  return {
    start: minutesToTime(start),
    end: minutesToTime(Math.max(end, start + 30)),
  };
};

export const validateBlocks = (blocks: TimeBlock[]) => {
  const sortedBlocks = sortBlocks(blocks);

  for (let index = 0; index < sortedBlocks.length; index += 1) {
    const block = sortedBlocks[index];
    if (timeToMinutes(block.start) >= timeToMinutes(block.end)) {
      return 'Each block must end after it starts.';
    }

    if (index > 0) {
      const previousBlock = sortedBlocks[index - 1];
      if (timeToMinutes(block.start) < timeToMinutes(previousBlock.end)) {
        return 'Blocks on the same day cannot overlap.';
      }
    }
  }

  return null;
};

export const availabilityHasAnyBlocks = (availability: WeeklyAvailability) =>
  WEEKDAYS.some((day) => availability[day].length > 0);

export const availabilityEquals = (left: WeeklyAvailability, right: WeeklyAvailability) =>
  JSON.stringify(normalizeAvailability(left)) === JSON.stringify(normalizeAvailability(right));
