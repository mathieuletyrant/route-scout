// A locally destructured Apollo lazy-query executor that happens to share the
// operationId — NOT the REST client. Import-aware must not count it.
export const b = () => {
  const [getWidget, { data }] = useWidgetLazyQuery();
  return getWidget();
};
