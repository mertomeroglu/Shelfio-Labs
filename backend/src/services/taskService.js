import { v4 as uuidv4 } from 'uuid';
import { taskRepo } from '../repositories/taskRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { sanitizeTaskInput, validateTaskPayload, includesSearchText } from '../utils/validators.js';
import { notificationService } from './notificationService.js';
import { parseBooleanQuery, parsePagePagination, resolveWhitelistedSort } from '../utils/pagination.js';

const TASK_NO_PREFIX = 'GV';
const CLOSED_TASK_STATUSES = new Set([
  'completed',
  'complete',
  'done',
  'closed',
  'resolved',
  'cancelled',
  'canceled',
  'archived',
  'tamamlandi',
  'tamamlandı',
  'kapandi',
  'kapandı',
  'iptal',
  'iptal_edildi',
  'arsiv',
  'arşiv',
]);

const normalizeTaskStatus = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');
const isTaskClosed = (task = {}) => CLOSED_TASK_STATUSES.has(normalizeTaskStatus(task.status));

const parseTaskNumber = (taskNo) => {
  const match = String(taskNo || '').trim().match(/^GV-(\d+)$/i);
  if (!match) {
    return null;
  }
  return Number(match[1]);
};

const formatTaskNumber = (sequence) => `${TASK_NO_PREFIX}-${String(sequence).padStart(4, '0')}`;

const ensureTaskNumbers = async () => {
  const tasks = await taskRepo.getAll();
  let maxSequence = 0;

  tasks.forEach((task) => {
    const parsed = parseTaskNumber(task.taskNo);
    if (parsed && parsed > maxSequence) {
      maxSequence = parsed;
    }
  });

  let nextSequence = maxSequence + 1;
  const normalizedTasks = [];

  for (const task of tasks) {
    const parsed = parseTaskNumber(task.taskNo);
    if (parsed) {
      normalizedTasks.push(task);
      continue;
    }

    const nextTask = {
      ...task,
      taskNo: formatTaskNumber(nextSequence),
      updatedAt: new Date().toISOString(),
    };
    nextSequence += 1;
    await taskRepo.updateById(task.id, nextTask);
    normalizedTasks.push(nextTask);
  }

  return normalizedTasks;
};

const enrichTask = async (task) => {
  const [assignee, creator] = await Promise.all([
    task.assignedTo ? userRepo.findById(task.assignedTo) : Promise.resolve(null),
    task.createdBy ? userRepo.findById(task.createdBy) : Promise.resolve(null),
  ]);

  return {
    ...task,
    assigneeName: assignee?.name || null,
    assigneeDepartment: assignee?.department || null,
    creatorName: creator?.name || null,
  };
};

const compactTask = (task = {}) => {
  const { comments, ...rest } = task;
  return {
    ...rest,
    commentsCount: Array.isArray(comments) ? comments.length : 0,
    lastCommentAt: Array.isArray(comments) && comments.length ? comments[comments.length - 1]?.createdAt || null : null,
  };
};

const TASK_SORTERS = {
  dueDate_asc: (a, b) => new Date(a.dueDate || a.createdAt || 0) - new Date(b.dueDate || b.createdAt || 0),
  dueDate_desc: (a, b) => new Date(b.dueDate || b.createdAt || 0) - new Date(a.dueDate || a.createdAt || 0),
  priority_desc: (a, b) => ({ high: 3, medium: 2, low: 1 }[b.priority] || 0) - ({ high: 3, medium: 2, low: 1 }[a.priority] || 0),
  updatedAt_desc: (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0),
};

const filterTasks = (tasks = [], query = {}) => {
  const search = String(query.search || query.q || '').trim();
  const assignedToMe = parseBooleanQuery(query.assignedToMe, false);
  const overdueOnly = parseBooleanQuery(query.overdueOnly, false);
  const now = Date.now();
  return tasks.filter((task) => {
    const matchesSearch = !search || [task.taskNo, task.title, task.description, task.assigneeName, task.creatorName]
      .filter(Boolean)
      .some((value) => includesSearchText(value, search));
    const matchesStatus = !query.status || task.status === query.status;
    const matchesPriority = !query.priority || task.priority === query.priority;
    const matchesAssigned = !query.assignedTo || task.assignedTo === query.assignedTo;
    const matchesAssignedToMe = !assignedToMe || task.assignedTo === query.userId;
    const dueMs = task.dueDate ? new Date(task.dueDate).getTime() : null;
    const matchesOverdue = !overdueOnly || (Number.isFinite(dueMs) && dueMs < now && !isTaskClosed(task));
    return matchesSearch && matchesStatus && matchesPriority && matchesAssigned && matchesAssignedToMe && matchesOverdue;
  });
};

const buildTaskListResult = async (tasks, query = {}) => {
  const pagination = parsePagePagination(query, { defaultLimit: 50, maxLimit: 200 });
  const sort = resolveWhitelistedSort(query.sort, Object.keys(TASK_SORTERS), 'dueDate_asc', { context: 'GET /api/tasks' });
  const enriched = await Promise.all(tasks.map((task) => enrichTask(task)));
  const filtered = filterTasks(enriched, query).sort(TASK_SORTERS[sort]);
  const items = filtered.slice(pagination.skip, pagination.skip + pagination.limit).map(compactTask);

  return {
    items,
    pagination: {
      mode: 'offset',
      page: pagination.page,
      limit: pagination.limit,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / pagination.limit)),
      hasNextPage: pagination.skip + items.length < filtered.length,
      nextCursor: null,
      cursorVersion: null,
    },
    filters: {
      status: query.status || null,
      priority: query.priority || null,
      assignedTo: query.assignedTo || null,
      assignedToMe: parseBooleanQuery(query.assignedToMe, false),
      overdueOnly: parseBooleanQuery(query.overdueOnly, false),
      search: String(query.search || query.q || '').trim() || null,
    },
    sort: { key: sort, direction: sort.endsWith('_asc') ? 'asc' : 'desc' },
  };
};

export const taskService = {
  async list(query = {}) {
    const tasks = await ensureTaskNumbers();
    return buildTaskListResult(tasks, query);
  },

  async listByUser(userId, query = {}) {
    const tasks = (await ensureTaskNumbers()).filter((t) => t.assignedTo === userId);
    return buildTaskListResult(tasks, { ...query, userId });
  },

  async getSummary(userId = null, query = {}) {
    const source = (await ensureTaskNumbers()).filter((task) => !userId || task.assignedTo === userId);
    const enriched = await Promise.all(source.map((task) => enrichTask(task)));
    const filtered = filterTasks(enriched, { ...query, userId });
    const now = Date.now();
    return {
      totalCount: filtered.length,
      activeCount: filtered.filter((task) => !isTaskClosed(task)).length,
      completedCount: filtered.filter((task) => isTaskClosed(task)).length,
      overdueCount: filtered.filter((task) => {
        const dueMs = task.dueDate ? new Date(task.dueDate).getTime() : null;
        return Number.isFinite(dueMs) && dueMs < now && !isTaskClosed(task);
      }).length,
      byPriority: filtered.reduce((acc, task) => {
        const key = task.priority || 'low';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    };
  },

  async getById(id) {
    const tasks = await ensureTaskNumbers();
    const task = tasks.find((item) => item.id === id);
    if (!task) {
      throw createNotFoundError('Görev bulunamadı');
    }
    return enrichTask(task);
  },

  async create(payload, createdBy, actorUser) {
    validateTaskPayload(payload);
    const input = sanitizeTaskInput(payload);
    const tasks = await ensureTaskNumbers();

    if (input.assignedTo) {
      const user = await userRepo.findById(input.assignedTo);
      if (!user) {
        throw new AppError(400, 'Geçersiz kullanıcı');
      }
    }

    const now = new Date().toISOString();
    const maxSequence = tasks.reduce((max, task) => {
      const parsed = parseTaskNumber(task.taskNo);
      return parsed && parsed > max ? parsed : max;
    }, 0);

    const task = {
      id: uuidv4(),
      taskNo: formatTaskNumber(maxSequence + 1),
      title: input.title,
      description: input.description,
      assignedTo: input.assignedTo,
      priority: input.priority,
      dueDate: input.dueDate,
      status: 'pending',
      comments: [],
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await taskRepo.create(task);
    const enriched = await enrichTask(task);
    await notificationService.handleTaskCreated(enriched, actorUser);
    if (enriched.assignedTo) {
      await notificationService.syncTaskAlertsForUser(enriched.assignedTo);
    }
    return enriched;
  },

  async update(id, payload, actorUser) {
    validateTaskPayload(payload, { partial: true });

    const existing = await taskRepo.findById(id);
    if (!existing) {
      throw createNotFoundError('Görev bulunamadı');
    }

    const input = sanitizeTaskInput({ ...existing, ...payload });

    if (input.assignedTo) {
      const user = await userRepo.findById(input.assignedTo);
      if (!user) {
        throw new AppError(400, 'Geçersiz kullanıcı');
      }
    }

    const updated = {
      ...existing,
      title: input.title,
      description: input.description,
      assignedTo: input.assignedTo,
      priority: input.priority,
      dueDate: input.dueDate,
      status: input.status,
      comments: Array.isArray(existing.comments) ? existing.comments : [],
      updatedAt: new Date().toISOString(),
    };

    await taskRepo.updateById(id, updated);
    const enriched = await enrichTask(updated);
    await notificationService.handleTaskUpdated(existing, enriched, actorUser);
    if (existing.assignedTo) {
      await notificationService.syncTaskAlertsForUser(existing.assignedTo);
    }
    if (enriched.assignedTo && enriched.assignedTo !== existing.assignedTo) {
      await notificationService.syncTaskAlertsForUser(enriched.assignedTo);
    }
    return enriched;
  },

  async toggleStatus(id, userId, actorUser) {
    const existing = await taskRepo.findById(id);
    if (!existing) {
      throw createNotFoundError('Görev bulunamadı');
    }

    if (existing.assignedTo !== userId) {
      throw new AppError(403, 'Bu görev size atanmamış');
    }

    const newStatus = existing.status === 'completed' ? 'pending' : 'completed';
    const updated = {
      ...existing,
      status: newStatus,
      comments: Array.isArray(existing.comments) ? existing.comments : [],
      updatedAt: new Date().toISOString(),
    };

    await taskRepo.updateById(id, updated);
    const enriched = await enrichTask(updated);
    await notificationService.handleTaskUpdated(existing, enriched, actorUser, { statusOnly: true });
    if (enriched.assignedTo) {
      await notificationService.syncTaskAlertsForUser(enriched.assignedTo);
    }
    return enriched;
  },

  async addComment(id, payload, actorUser) {
    const existing = await taskRepo.findById(id);
    if (!existing) {
      throw createNotFoundError('Görev bulunamadı');
    }

    const text = String(payload?.text || '').trim();
    if (!text) {
      throw new AppError(400, 'Yorum metni zorunludur');
    }

    const comments = Array.isArray(existing.comments) ? existing.comments : [];
    const comment = {
      id: uuidv4(),
      text,
      authorId: actorUser?.id || null,
      authorName: actorUser?.name || 'Sistem',
      createdAt: new Date().toISOString(),
    };

    const updated = {
      ...existing,
      comments: [...comments, comment],
      updatedAt: new Date().toISOString(),
    };

    await taskRepo.updateById(id, updated);
    const enriched = await enrichTask(updated);
    await notificationService.handleTaskComment(enriched, comment.text, actorUser);
    return enriched;
  },

  async remove(id) {
    const existing = await taskRepo.findById(id);
    if (!existing) {
      throw createNotFoundError('Görev bulunamadı');
    }

    await taskRepo.deleteById(id);
    return existing;
  },
};

