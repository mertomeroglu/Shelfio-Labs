import { v4 as uuidv4 } from 'uuid';
import { taskRepo } from '../repositories/taskRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { getActiveTenantId } from '../tenant/tenantContext.js';
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
const isPostgresStore = config.dataStore === 'postgres';

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

const buildTaskOrderBy = (sort = 'dueDate_asc') => {
  if (sort === 'dueDate_desc') return [{ dueDate: 'desc' }, { createdAt: 'desc' }];
  if (sort === 'priority_desc') return [{ priority: 'desc' }, { createdAt: 'desc' }];
  if (sort === 'updatedAt_desc') return [{ updatedAt: 'desc' }];
  return [{ dueDate: 'asc' }, { createdAt: 'desc' }];
};

const buildTaskWhere = ({ query = {}, userId = null } = {}) => {
  const search = String(query.search || query.q || '').trim();
  const assignedToMe = parseBooleanQuery(query.assignedToMe, false);
  const overdueOnly = parseBooleanQuery(query.overdueOnly, false);
  const nowIso = new Date().toISOString();
  const where = {
    tenantId: getActiveTenantId(),
  };

  const assignedTo = String(query.assignedTo || '').trim();
  const effectiveAssignedTo = assignedToMe && userId ? String(userId).trim() : assignedTo;
  if (effectiveAssignedTo) {
    where.assignedTo = effectiveAssignedTo;
  }
  if (query.status) {
    where.status = String(query.status);
  }
  if (query.priority) {
    where.priority = String(query.priority);
  }
  if (overdueOnly) {
    where.dueDate = { lt: nowIso };
    where.NOT = {
      status: {
        in: [...CLOSED_TASK_STATUSES],
      },
    };
  }
  if (search) {
    where.OR = [
      { taskNo: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { assignee: { name: { contains: search, mode: 'insensitive' } } },
      { creator: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  return where;
};

const buildTaskListResultFromRows = ({ rows = [], total = 0, query = {}, sort = 'dueDate_asc', pagination }) => ({
  items: rows.map((task) => {
    const commentsCount = Number(task?._count?.commentRows || 0) || (Array.isArray(task.comments) ? task.comments.length : 0);
    const latestCommentAt = task?.commentRows?.[0]?.createdAt ? new Date(task.commentRows[0].createdAt).toISOString() : (
      Array.isArray(task.comments) && task.comments.length ? task.comments[task.comments.length - 1]?.createdAt || null : null
    );
    return {
      ...task,
      assigneeName: task?.assignee?.name || null,
      assigneeDepartment: task?.assignee?.department || null,
      creatorName: task?.creator?.name || null,
      commentsCount,
      lastCommentAt: latestCommentAt,
    };
  }).map(compactTask),
  pagination: {
    mode: 'offset',
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
    hasNextPage: pagination.skip + rows.length < total,
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
});

const listTasksPostgres = async (query = {}, { userId = null } = {}) => {
  const prisma = await getPrisma();
  const pagination = parsePagePagination(query, { defaultLimit: 50, maxLimit: 200 });
  const sort = resolveWhitelistedSort(query.sort, Object.keys(TASK_SORTERS), 'dueDate_asc', { context: 'GET /api/tasks' });
  const where = buildTaskWhere({ query, userId });

  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: buildTaskOrderBy(sort),
      skip: pagination.skip,
      take: pagination.limit,
      select: {
        id: true,
        taskNo: true,
        title: true,
        description: true,
        assignedTo: true,
        priority: true,
        dueDate: true,
        status: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        comments: true,
        assignee: {
          select: {
            id: true,
            name: true,
            department: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
          },
        },
        commentRows: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            createdAt: true,
          },
        },
        _count: {
          select: {
            commentRows: true,
          },
        },
      },
    }),
    prisma.task.count({ where }),
  ]);

  return buildTaskListResultFromRows({ rows, total, query, sort, pagination });
};

const summarizeTaskRows = (rows = []) => {
  const now = Date.now();
  return {
    totalCount: rows.length,
    activeCount: rows.filter((task) => !isTaskClosed(task)).length,
    completedCount: rows.filter((task) => isTaskClosed(task)).length,
    overdueCount: rows.filter((task) => {
      const dueMs = task.dueDate ? new Date(task.dueDate).getTime() : null;
      return Number.isFinite(dueMs) && dueMs < now && !isTaskClosed(task);
    }).length,
    byPriority: rows.reduce((acc, task) => {
      const key = task.priority || 'low';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
};

const getTaskSummaryPostgres = async (query = {}, { userId = null } = {}) => {
  const prisma = await getPrisma();
  const where = buildTaskWhere({ query, userId });
  const rows = await prisma.task.findMany({
    where,
    select: {
      priority: true,
      dueDate: true,
      status: true,
    },
  });
  return summarizeTaskRows(rows);
};

const getTaskByIdPostgres = async (id) => {
  const prisma = await getPrisma();
  const task = await prisma.task.findFirst({
    where: {
      tenantId: getActiveTenantId(),
      id,
    },
    select: {
      id: true,
      taskNo: true,
      title: true,
      description: true,
      assignedTo: true,
      priority: true,
      dueDate: true,
      status: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
      comments: true,
      assignee: {
        select: {
          id: true,
          name: true,
          department: true,
        },
      },
      creator: {
        select: {
          id: true,
          name: true,
        },
      },
      commentRows: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          text: true,
          authorId: true,
          authorName: true,
          createdAt: true,
        },
      },
    },
  });

  if (!task) {
    throw createNotFoundError('Görev bulunamadı');
  }

  return {
    ...task,
    assigneeName: task?.assignee?.name || null,
    assigneeDepartment: task?.assignee?.department || null,
    creatorName: task?.creator?.name || null,
    comments: Array.isArray(task.commentRows) && task.commentRows.length
      ? task.commentRows.map((comment) => ({
        ...comment,
        createdAt: comment.createdAt ? new Date(comment.createdAt).toISOString() : null,
      }))
      : (Array.isArray(task.comments) ? task.comments : []),
  };
};

const getNextTaskNumber = async () => {
  if (!isPostgresStore) {
    const tasks = await taskRepo.getAll();
    const maxSequence = tasks.reduce((max, task) => {
      const parsed = parseTaskNumber(task.taskNo);
      return parsed && parsed > max ? parsed : max;
    }, 0);
    return formatTaskNumber(maxSequence + 1);
  }

  const prisma = await getPrisma();
  const latest = await prisma.task.findFirst({
    where: {
      tenantId: getActiveTenantId(),
      taskNo: {
        startsWith: `${TASK_NO_PREFIX}-`,
      },
    },
    orderBy: {
      taskNo: 'desc',
    },
    select: {
      taskNo: true,
    },
  });
  return formatTaskNumber((parseTaskNumber(latest?.taskNo) || 0) + 1);
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
    if (isPostgresStore) {
      return listTasksPostgres(query);
    }
    const tasks = await ensureTaskNumbers();
    return buildTaskListResult(tasks, query);
  },

  async listByUser(userId, query = {}) {
    if (isPostgresStore) {
      return listTasksPostgres(query, { userId });
    }
    const tasks = (await ensureTaskNumbers()).filter((t) => t.assignedTo === userId);
    return buildTaskListResult(tasks, { ...query, userId });
  },

  async getSummary(userId = null, query = {}) {
    if (isPostgresStore) {
      return getTaskSummaryPostgres(query, { userId });
    }
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
    if (isPostgresStore) {
      return getTaskByIdPostgres(id);
    }
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

    if (input.assignedTo) {
      const user = await userRepo.findById(input.assignedTo);
      if (!user) {
        throw new AppError(400, 'Geçersiz kullanıcı');
      }
    }

    const now = new Date().toISOString();

    const task = {
      id: uuidv4(),
      taskNo: await getNextTaskNumber(),
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

