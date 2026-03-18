/**
 * Represents a user in the Stride platform.
 */
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Represents a top-level goal.
 */
export interface Goal {
  id: string;
  userId: string;
  title: string;
  description?: string;
  status: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
}

/**
 * Represents a phase within a goal.
 */
export interface Phase {
  id: string;
  goalId: string;
  title: string;
  order: number;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
  updatedAt: string;
}

/**
 * Represents a learning or actionable topic.
 */
export interface Topic {
  id: string;
  phaseId: string;
  title: string;
  description?: string;
  order: number;
  createdAt: string;
}

/**
 * Represents a resource (link, video, article) for a topic or task.
 */
export interface Resource {
  id: string;
  title: string;
  url: string;
  type: 'article' | 'video' | 'book' | 'other';
  createdAt: string;
}

/**
 * Represents an actionable task.
 */
export interface Task {
  id: string;
  goalId: string;
  phaseId?: string;
  topicId?: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'done';
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Represents a smaller step within a task.
 */
export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
  order: number;
  createdAt: string;
}

/**
 * Represents a skill acquired or being developed.
 */
export interface Skill {
  id: string;
  userId: string;
  name: string;
  proficiencyLevel: number;
  createdAt: string;
}

/**
 * Represents a community room or channel.
 */
export interface CommunityRoom {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

/**
 * Represents a message from the AI mentor.
 */
export interface MentorMessage {
  id: string;
  userId: string;
  content: string;
  role: 'user' | 'assistant';
  createdAt: string;
}

/**
 * Represents data collected during goal intake.
 */
export interface GoalIntake {
  title: string;
  motivation: string;
  targetDate?: string;
  currentSkillLevel: string;
}

/**
 * Represents a daily task card presented to the user.
 */
export interface DailyTaskCard {
  id: string;
  taskId: string;
  title: string;
  context: string;
  recommendedDurationMinutes: number;
}

/**
 * Represents user's typical weekly availability for tasks.
 */
export interface WeeklyAvailability {
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
}

/**
 * Represents a scheduled block of time for working on goals.
 */
export interface TimeBlock {
  id: string;
  userId: string;
  startTime: string;
  endTime: string;
  taskId?: string;
}
