export const buildListResult = ({ items, pagination, filters = {}, sort = {} }) => ({
  items: Array.isArray(items) ? items : [],
  pagination: pagination || null,
  filters,
  sort,
});

export const sendListResponse = (res, result) => {
  if (result?.items && result?.pagination) {
    res.json({
      success: true,
      data: result.items,
      meta: {
        pagination: result.pagination,
        filters: result.filters || {},
        sort: result.sort || {},
        ...(result.summary ? { summary: result.summary } : {}),
      },
    });
    return;
  }

  res.json({ success: true, data: result });
};
