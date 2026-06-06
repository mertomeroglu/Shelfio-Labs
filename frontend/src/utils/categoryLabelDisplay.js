export const getReadableCategoryLabelName = (item) => {
  const name = String(
    item?.labelName
    || item?.name
    || item?.displayName
    || item?.label
    || ''
  ).trim();

  if (name) return name;
  return String(item?.labelDisplayCode || item?.labelCode || item?.code || '').trim();
};
