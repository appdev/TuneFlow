enum AppLayoutClass { mobile, narrow, desktop }

AppLayoutClass classifyLayout(double width) {
  if (width < 720) return AppLayoutClass.mobile;
  if (width < 1180) return AppLayoutClass.narrow;
  return AppLayoutClass.desktop;
}

/// Compatibility adapter for the existing feature widgets during migration.
enum AppLayout { phone, tablet }

AppLayout appLayoutForWidth(double width) =>
    classifyLayout(width) == AppLayoutClass.mobile
    ? AppLayout.phone
    : AppLayout.tablet;
