#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

static const CGFloat kOcrCaptureWidth = 860.0;
static const CGFloat kOcrCaptureHeight = 108.0;
static const CGFloat kOcrCaptureLeftContext = 220.0;
static const CGFloat kOcrCaptureTopContext = 42.0;
static const NSInteger kAssistantUsableTextLength = 8;
static const CGFloat kTipWindowMinWidth = 148.0;
static const CGFloat kTipWindowMinHeight = 92.0;
static const CGFloat kTipWindowMaxWidth = 520.0;
static const CGFloat kTipOffsetX = 20.0;
static const CGFloat kTipOffsetY = 20.0;
static const CGFloat kTipHorizontalPadding = 16.0;
static const CGFloat kTipTopPadding = 14.0;
static const CGFloat kTipBottomPadding = 12.0;
static const CGFloat kTipLabelHeight = 18.0;
static const CGFloat kTipMetaHeight = 18.0;
static const CGFloat kTipSectionGap = 8.0;
static const CGFloat kTipCellWidthSlack = 6.0;
static const CGFloat kTipCellHeightSlack = 4.0;

static NSPanel *gTipWindow = nil;
static NSBox *gTipBubble = nil;
static NSTextField *gTipLabelField = nil;
static NSTextField *gTipAnswerField = nil;
static NSTextField *gTipMetaField = nil;

static NSDictionary *makeSuccess(id result);
static NSDictionary *makeError(NSString *message);

static void runOnMainThreadSync(dispatch_block_t block) {
  if ([NSThread isMainThread]) {
    block();
    return;
  }

  dispatch_sync(dispatch_get_main_queue(), block);
}

static NSTextField *makeTipField(CGRect frame, NSFont *font, NSColor *color) {
  NSTextField *field = [[NSTextField alloc] initWithFrame:frame];
  field.editable = NO;
  field.bezeled = NO;
  field.drawsBackground = NO;
  field.selectable = NO;
  field.font = font;
  field.textColor = color;
  field.lineBreakMode = NSLineBreakByTruncatingTail;
  return field;
}

static NSTextFieldCell *makeMeasurementCell(NSTextField *field, NSString *text, BOOL wraps) {
  NSTextFieldCell *cell = [[NSTextFieldCell alloc] initTextCell:text ?: @""];
  cell.font = field.font;
  cell.editable = NO;
  cell.selectable = NO;
  cell.scrollable = NO;
  cell.wraps = wraps;
  cell.usesSingleLineMode = !wraps;
  cell.lineBreakMode = wraps ? NSLineBreakByWordWrapping : NSLineBreakByClipping;
  return cell;
}

static CGFloat measureTipCellSingleLineWidth(NSTextField *field, NSString *text) {
  if (text.length == 0) {
    return 0;
  }

  NSTextFieldCell *cell = makeMeasurementCell(field, text, NO);
  return ceil([cell cellSize].width);
}

static CGFloat measureTipCellWrappedHeight(NSTextField *field, NSString *text, CGFloat width) {
  if (text.length == 0) {
    return 0;
  }

  NSTextFieldCell *cell = makeMeasurementCell(field, text, YES);
  return ceil([cell cellSizeForBounds:NSMakeRect(0, 0, width, CGFLOAT_MAX)].height);
}

static NSScreen *screenForPoint(CGPoint point) {
  for (NSScreen *screen in [NSScreen screens]) {
    if (NSPointInRect(point, screen.frame)) {
      return screen;
    }
  }

  return [NSScreen mainScreen] ?: [NSScreen screens].firstObject;
}

static void ensureTipWindow(void) {
  if (gTipWindow != nil) {
    return;
  }

  NSRect frame = NSMakeRect(0, 0, kTipWindowMinWidth, kTipWindowMinHeight);
  NSPanel *panel = [[NSPanel alloc] initWithContentRect:frame
                                              styleMask:NSWindowStyleMaskBorderless
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
  panel.backgroundColor = [NSColor clearColor];
  panel.opaque = NO;
  panel.hasShadow = YES;
  panel.hidesOnDeactivate = NO;
  panel.ignoresMouseEvents = YES;
  panel.level = CGWindowLevelForKey(kCGScreenSaverWindowLevelKey);
  panel.collectionBehavior =
    NSWindowCollectionBehaviorCanJoinAllSpaces |
    NSWindowCollectionBehaviorFullScreenAuxiliary |
    NSWindowCollectionBehaviorTransient |
    NSWindowCollectionBehaviorIgnoresCycle;
  panel.excludedFromWindowsMenu = YES;
  panel.movable = NO;
  panel.releasedWhenClosed = NO;
  panel.sharingType = NSWindowSharingNone;

  NSView *contentView = [[NSView alloc] initWithFrame:frame];
  contentView.wantsLayer = NO;
  panel.contentView = contentView;

  NSBox *bubble = [[NSBox alloc] initWithFrame:contentView.bounds];
  bubble.boxType = NSBoxCustom;
  bubble.borderType = NSNoBorder;
  bubble.titlePosition = NSNoTitle;
  bubble.cornerRadius = 18.0;
  bubble.borderWidth = 1.0;
  bubble.fillColor = [NSColor colorWithSRGBRed:0.08 green:0.40 blue:0.29 alpha:0.97];
  bubble.borderColor = [NSColor colorWithWhite:1 alpha:0.14];
  [contentView addSubview:bubble];

  NSTextField *labelField = makeTipField(NSMakeRect(16, 60, 150, 18), [NSFont boldSystemFontOfSize:11], [NSColor colorWithWhite:1 alpha:0.78]);
  labelField.stringValue = @"标准答案";
  [bubble addSubview:labelField];

  NSTextField *answerField = makeTipField(NSMakeRect(16, 26, 120, 34), [NSFont systemFontOfSize:32 weight:NSFontWeightBlack], [NSColor whiteColor]);
  answerField.lineBreakMode = NSLineBreakByWordWrapping;
  answerField.maximumNumberOfLines = 0;
  answerField.usesSingleLineMode = NO;
  answerField.cell.wraps = YES;
  answerField.cell.scrollable = NO;
  [bubble addSubview:answerField];

  NSTextField *metaField = makeTipField(NSMakeRect(16, 10, 180, 18), [NSFont systemFontOfSize:13 weight:NSFontWeightMedium], [NSColor colorWithWhite:1 alpha:0.82]);
  [bubble addSubview:metaField];

  gTipWindow = panel;
  gTipBubble = bubble;
  gTipLabelField = labelField;
  gTipAnswerField = answerField;
  gTipMetaField = metaField;
}

static void layoutTipWindow(NSString *answer) {
  ensureTipWindow();
  if (gTipWindow == nil || gTipBubble == nil) {
    return;
  }

  NSString *labelText = gTipLabelField.stringValue ?: @"";
  NSString *metaText = gTipMetaField.stringValue ?: @"";
  CGFloat contentWidth = kTipWindowMinWidth;
  CGFloat answerMaxWidth = kTipWindowMaxWidth - kTipHorizontalPadding * 2;
  CGFloat labelWidth = measureTipCellSingleLineWidth(gTipLabelField, labelText);
  CGFloat metaWidth = measureTipCellSingleLineWidth(gTipMetaField, metaText);
  CGFloat answerPreferredWidth = measureTipCellSingleLineWidth(gTipAnswerField, answer);
  CGFloat preferredTextWidth = MIN(MAX(MAX(labelWidth, metaWidth), answerPreferredWidth + kTipCellWidthSlack), answerMaxWidth);
  contentWidth = MIN(MAX(kTipWindowMinWidth, preferredTextWidth + kTipHorizontalPadding * 2), kTipWindowMaxWidth);

  CGFloat answerWidth = contentWidth - kTipHorizontalPadding * 2;
  CGFloat answerHeight = MAX(34.0, measureTipCellWrappedHeight(gTipAnswerField, answer, answerWidth) + kTipCellHeightSlack);
  CGFloat contentHeight = MAX(
    kTipWindowMinHeight,
    kTipTopPadding + kTipLabelHeight + kTipSectionGap + answerHeight + kTipSectionGap + kTipMetaHeight + kTipBottomPadding
  );

  [gTipWindow setContentSize:NSMakeSize(contentWidth, contentHeight)];
  NSView *contentView = gTipWindow.contentView;
  contentView.frame = NSMakeRect(0, 0, contentWidth, contentHeight);
  gTipBubble.frame = contentView.bounds;

  CGFloat labelY = contentHeight - kTipTopPadding - kTipLabelHeight;
  CGFloat answerY = kTipBottomPadding + kTipMetaHeight + kTipSectionGap;
  CGFloat metaY = kTipBottomPadding;
  CGFloat textWidth = contentWidth - kTipHorizontalPadding * 2;

  gTipLabelField.frame = NSMakeRect(kTipHorizontalPadding, labelY, textWidth, kTipLabelHeight);
  gTipAnswerField.frame = NSMakeRect(kTipHorizontalPadding, answerY, textWidth, answerHeight);
  gTipMetaField.frame = NSMakeRect(kTipHorizontalPadding, metaY, textWidth, kTipMetaHeight);
}

static void positionTipWindow(CGPoint point) {
  ensureTipWindow();
  if (gTipWindow == nil) {
    return;
  }

  NSScreen *screen = screenForPoint(point);
  NSRect screenFrame = screen ? screen.frame : NSMakeRect(0, 0, 1440, 900);
  NSRect windowFrame = gTipWindow.frame;
  CGFloat windowWidth = windowFrame.size.width;
  CGFloat windowHeight = windowFrame.size.height;
  CGFloat x = point.x + kTipOffsetX;
  if (x + windowWidth > NSMaxX(screenFrame) - 8) {
    x = MAX(NSMinX(screenFrame) + 8, point.x - windowWidth - kTipOffsetX);
  }

  CGFloat y = point.y - windowHeight - kTipOffsetY;
  if (y < NSMinY(screenFrame) + 8) {
    y = MIN(NSMaxY(screenFrame) - windowHeight - 8, point.y + kTipOffsetY);
  }

  [gTipWindow setFrame:NSMakeRect(x, y, windowWidth, windowHeight) display:NO];
}

static NSDictionary *showTipWindow(NSDictionary *params) {
  __block NSDictionary *result = nil;
  runOnMainThreadSync(^{
    ensureTipWindow();
    if (gTipWindow == nil || ![params isKindOfClass:[NSDictionary class]]) {
      result = makeError(@"tip-window-unavailable");
      return;
    }

    NSString *answer = [params[@"answer"] isKindOfClass:[NSString class]] ? params[@"answer"] : @"";
    NSNumber *confidence = [params[@"confidence"] isKindOfClass:[NSNumber class]] ? params[@"confidence"] : @0;
    NSNumber *x = [params[@"x"] isKindOfClass:[NSNumber class]] ? params[@"x"] : @0;
    NSNumber *y = [params[@"y"] isKindOfClass:[NSNumber class]] ? params[@"y"] : @0;

    gTipAnswerField.stringValue = answer.length > 0 ? answer : @"-";
    gTipMetaField.stringValue = [NSString stringWithFormat:@"匹配置信度 %.1f%%", confidence.doubleValue];
    layoutTipWindow(gTipAnswerField.stringValue);
    positionTipWindow(CGPointMake(x.doubleValue, y.doubleValue));
    [gTipWindow orderFrontRegardless];
    result = makeSuccess(@{});
  });

  return result ?: makeError(@"tip-window-unavailable");
}

static NSDictionary *hideTipWindow(void) {
  runOnMainThreadSync(^{
    [gTipWindow orderOut:nil];
  });
  return makeSuccess(@{});
}

static void writeJson(NSDictionary *payload) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
  if (data == nil) {
    NSString *fallback = [NSString stringWithFormat:@"{\"ok\":false,\"error\":\"%@\"}\n", error.localizedDescription ?: @"json-error"];
    [[NSFileHandle fileHandleWithStandardOutput] writeData:[fallback dataUsingEncoding:NSUTF8StringEncoding]];
    return;
  }

  NSMutableData *line = [data mutableCopy];
  [line appendData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
  [[NSFileHandle fileHandleWithStandardOutput] writeData:line];
}

static BOOL writeJsonToPath(NSDictionary *payload, NSString *path) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
  if (data == nil) {
    return NO;
  }
  return [data writeToFile:path options:NSDataWritingAtomic error:&error];
}

static NSDictionary *makeSuccess(id result) {
  return @{
    @"ok": @YES,
    @"result": result ?: @{}
  };
}

static NSDictionary *makeError(NSString *message) {
  return @{
    @"ok": @NO,
    @"error": message ?: @"unknown-error"
  };
}

static NSDictionary *payloadWithRequestId(NSDictionary *payload, id requestId) {
  if (requestId == nil || requestId == [NSNull null]) {
    return payload;
  }

  NSMutableDictionary *next = [payload mutableCopy];
  next[@"id"] = requestId;
  return next;
}

static NSString *permissionValue(BOOL granted) {
  return granted ? @"granted" : @"missing";
}

static NSInteger compactLength(NSString *text) {
  if (text == nil) {
    return 0;
  }

  NSString *compact = [[text componentsSeparatedByCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] componentsJoinedByString:@""];
  return compact.length;
}

static BOOL screenCaptureSupported(void) {
  if (@available(macOS 15.2, *)) {
    return YES;
  }
  return NO;
}

static BOOL hasScreenCapturePermission(void) {
  if (@available(macOS 15.2, *)) {
    return CGPreflightScreenCaptureAccess();
  }
  return NO;
}

static BOOL requestScreenCapturePermission(void) {
  if (@available(macOS 15.2, *)) {
    return CGRequestScreenCaptureAccess();
  }
  return NO;
}

static NSDictionary *permissionsStatus(void) {
  BOOL accessibility = AXIsProcessTrusted();
  BOOL screenCapture = screenCaptureSupported() ? hasScreenCapturePermission() : NO;

  return @{
    @"platform": @"darwin",
    @"helper": @"granted",
    @"accessibility": permissionValue(accessibility),
    @"screenCapture": screenCaptureSupported() ? permissionValue(screenCapture) : @"unsupported",
    @"ocrRuntime": screenCaptureSupported() ? @"granted" : @"unsupported"
  };
}

static NSDictionary *requestPermissions(void) {
  if (!AXIsProcessTrusted()) {
    NSDictionary *options = @{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES };
    AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
  }

  if (screenCaptureSupported() && !hasScreenCapturePermission()) {
    requestScreenCapturePermission();
  }

  return permissionsStatus();
}

static NSString *trimmedString(id raw) {
  if (raw == nil || raw == [NSNull null]) return nil;

  if ([raw isKindOfClass:[NSString class]]) {
    NSString *text = [(NSString *)raw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    return text.length > 0 ? text : nil;
  }

  if ([raw isKindOfClass:[NSAttributedString class]]) {
    NSString *text = [[(NSAttributedString *)raw string] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    return text.length > 0 ? text : nil;
  }

  if ([raw isKindOfClass:[NSArray class]]) {
    NSMutableArray<NSString *> *parts = [NSMutableArray array];
    for (id item in (NSArray *)raw) {
      NSString *text = trimmedString(item);
      if (text.length > 0) {
        [parts addObject:text];
      }
    }
    if (parts.count == 0) return nil;
    return [parts componentsJoinedByString:@" "];
  }

  NSString *text = [[raw description] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  return text.length > 0 ? text : nil;
}

static NSString *attributeValue(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef value = nil;
  AXError result = AXUIElementCopyAttributeValue(element, attribute, &value);
  if (result != kAXErrorSuccess || value == nil) {
    return nil;
  }

  NSString *text = trimmedString((__bridge id)value);
  CFRelease(value);
  return text;
}

static AXUIElementRef parentElement(AXUIElementRef element) {
  CFTypeRef value = nil;
  AXError result = AXUIElementCopyAttributeValue(element, kAXParentAttribute, &value);
  if (result != kAXErrorSuccess || value == nil) {
    return nil;
  }

  return (AXUIElementRef)value;
}

static NSString *extractAccessibilityText(CGPoint point) {
  AXUIElementRef systemWide = AXUIElementCreateSystemWide();
  AXUIElementRef hovered = nil;
  AXError result = AXUIElementCopyElementAtPosition(systemWide, point.x, point.y, &hovered);
  CFRelease(systemWide);

  if (result != kAXErrorSuccess || hovered == nil) {
    return nil;
  }

  CFStringRef attributes[] = {
    kAXSelectedTextAttribute,
    kAXValueAttribute,
    kAXDescriptionAttribute,
    kAXTitleAttribute,
    kAXHelpAttribute
  };

  AXUIElementRef current = hovered;
  NSString *matched = nil;

  for (NSInteger depth = 0; depth < 4 && current != nil && matched == nil; depth += 1) {
    for (NSInteger index = 0; index < (NSInteger)(sizeof(attributes) / sizeof(CFStringRef)); index += 1) {
      NSString *text = attributeValue(current, attributes[index]);
      if (text != nil) {
        if (compactLength(text) >= kAssistantUsableTextLength) {
          matched = text;
          break;
        }
      }
    }

    if (matched != nil) {
      break;
    }

    AXUIElementRef parent = parentElement(current);
    if (current != hovered) {
      CFRelease(current);
    }
    current = parent;
  }

  if (current != nil) {
    CFRelease(current);
  }

  return matched;
}

static CGPoint currentMouseLocationForScreenCapture(void) {
  CGEventRef event = CGEventCreate(NULL);
  if (event == nil) {
    return CGPointZero;
  }

  CGPoint point = CGEventGetLocation(event);
  CFRelease(event);
  return point;
}

static CGRect captureRectForPoint(CGPoint point) {
  CGRect rect = CGRectMake(point.x - kOcrCaptureLeftContext, point.y - kOcrCaptureTopContext, kOcrCaptureWidth, kOcrCaptureHeight);

  CGDirectDisplayID display = kCGNullDirectDisplay;
  uint32_t count = 0;
  if (CGGetDisplaysWithPoint(point, 1, &display, &count) == kCGErrorSuccess && count > 0) {
    CGRect bounds = CGDisplayBounds(display);
    CGFloat minX = MAX(CGRectGetMinX(bounds), CGRectGetMinX(rect));
    CGFloat minY = MAX(CGRectGetMinY(bounds), CGRectGetMinY(rect));
    CGFloat maxX = MIN(CGRectGetMaxX(bounds), CGRectGetMaxX(rect));
    CGFloat maxY = MIN(CGRectGetMaxY(bounds), CGRectGetMaxY(rect));
    if (maxX > minX && maxY > minY) {
      rect = CGRectMake(minX, minY, maxX - minX, maxY - minY);
    }
  }

  return rect;
}

static CGImageRef copyScreenImageInRect(CGRect rect) {
  if (!screenCaptureSupported()) {
    return nil;
  }

  __block CGImageRef capturedImage = nil;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

  if (@available(macOS 15.2, *)) {
    [SCScreenshotManager captureImageInRect:rect completionHandler:^(CGImageRef _Nullable image, NSError * _Nullable error) {
      if (image != nil) {
        capturedImage = CGImageRetain(image);
      }
      dispatch_semaphore_signal(semaphore);
    }];
  } else {
    dispatch_semaphore_signal(semaphore);
  }

  dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2 * NSEC_PER_SEC));
  dispatch_semaphore_wait(semaphore, timeout);
  return capturedImage;
}

static NSString *captureImagePathForPoint(CGPoint point, CGRect *captureRectOut) {
  if (!screenCaptureSupported() || !hasScreenCapturePermission()) {
    return nil;
  }

  CGRect captureRect = captureRectForPoint(point);
  if (CGRectIsEmpty(captureRect) || CGRectIsNull(captureRect)) {
    return nil;
  }

  CGImageRef image = copyScreenImageInRect(captureRect);
  if (image == nil) {
    return nil;
  }

  NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
  NSData *pngData = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  CGImageRelease(image);

  if (pngData == nil) {
    return nil;
  }

  NSString *imagePath = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"mengdian-assistant-capture-%d.png", [[NSProcessInfo processInfo] processIdentifier]]];
  NSError *error = nil;
  BOOL wrote = [pngData writeToFile:imagePath options:NSDataWritingAtomic error:&error];
  if (!wrote) {
    return nil;
  }

  if (captureRectOut != NULL) {
    *captureRectOut = captureRect;
  }

  return imagePath;
}

static NSDictionary *inspectAtCursor(void) {
  NSPoint mouse = [NSEvent mouseLocation];
  CGPoint capturePoint = currentMouseLocationForScreenCapture();
  NSString *text = extractAccessibilityText(CGPointMake(mouse.x, mouse.y));
  CGRect captureRect = CGRectNull;
  NSString *ocrImagePath = nil;

  if (compactLength(text) < kAssistantUsableTextLength) {
    ocrImagePath = captureImagePathForPoint(capturePoint, &captureRect);
  }

  return @{
    @"point": @{
      @"x": @((NSInteger)mouse.x),
      @"y": @((NSInteger)mouse.y)
    },
    @"ocrPoint": @{
      @"x": @(capturePoint.x),
      @"y": @(capturePoint.y)
    },
    @"ocrCaptureRect": CGRectIsNull(captureRect) || CGRectIsEmpty(captureRect)
      ? [NSNull null]
      : @{
          @"x": @(captureRect.origin.x),
          @"y": @(captureRect.origin.y),
          @"width": @(captureRect.size.width),
          @"height": @(captureRect.size.height)
        },
    @"ocrImagePath": ocrImagePath ?: [NSNull null],
    @"accessibilityText": text ?: [NSNull null],
    @"ocrText": [NSNull null]
  };
}

static NSDictionary *handleMethod(NSString *method, NSDictionary *params) {
  if ([method isEqualToString:@"status"]) {
    return makeSuccess(permissionsStatus());
  }

  if ([method isEqualToString:@"requestPermissions"]) {
    return makeSuccess(requestPermissions());
  }

  if ([method isEqualToString:@"inspectAtCursor"]) {
    return makeSuccess(inspectAtCursor());
  }

  if ([method isEqualToString:@"showTip"]) {
    return showTipWindow(params);
  }

  if ([method isEqualToString:@"hideTip"]) {
    return hideTipWindow();
  }

  return makeError([NSString stringWithFormat:@"Unsupported method: %@", method]);
}

static void stopHelperApplication(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (NSApp == nil) {
      return;
    }

    [NSApp stop:nil];
    NSEvent *event = [NSEvent otherEventWithType:NSEventTypeApplicationDefined
                                        location:NSZeroPoint
                                   modifierFlags:0
                                       timestamp:0
                                    windowNumber:0
                                         context:nil
                                         subtype:0
                                           data1:0
                                           data2:0];
    [NSApp postEvent:event atStart:NO];
  });
}

static int serveRequests(void) {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      char buffer[4096];

      while (fgets(buffer, sizeof(buffer), stdin) != NULL) {
        NSString *line = [[NSString stringWithUTF8String:buffer] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        if (line.length == 0) {
          continue;
        }

        NSString *method = line;
        id requestId = nil;
        NSDictionary *params = nil;

        NSData *jsonData = [line dataUsingEncoding:NSUTF8StringEncoding];
        if (jsonData != nil) {
          NSError *parseError = nil;
          id parsed = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&parseError];
          if (parseError == nil && [parsed isKindOfClass:[NSDictionary class]]) {
            NSDictionary *request = (NSDictionary *)parsed;
            id rawMethod = request[@"method"];
            if ([rawMethod isKindOfClass:[NSString class]] && [(NSString *)rawMethod length] > 0) {
              method = (NSString *)rawMethod;
              requestId = request[@"id"];
              if ([request[@"params"] isKindOfClass:[NSDictionary class]]) {
                params = request[@"params"];
              }
            }
          }
        }

        NSDictionary *response = payloadWithRequestId(handleMethod(method, params), requestId);
        writeJson(response);
        if (![response[@"ok"] boolValue]) {
          fflush(stdout);
        }
      }

      stopHelperApplication();
    }
  });

  [NSApp run];
  return 0;
}

int main(int argc, const char * argv[]) {
  @autoreleasepool {
    NSString *method = @"status";
    NSString *outputPath = nil;

    for (int index = 1; index < argc; index += 1) {
      NSString *argument = [NSString stringWithUTF8String:argv[index]];
      if ([argument isEqualToString:@"--output"] && index + 1 < argc) {
        outputPath = [NSString stringWithUTF8String:argv[index + 1]];
        index += 1;
        continue;
      }
      method = argument;
    }

    if ([method isEqualToString:@"serve"]) {
      return serveRequests();
    }

    NSDictionary *payload = handleMethod(method, nil);

    if (outputPath.length > 0) {
      if (!writeJsonToPath(payload, outputPath)) {
        writeJson(makeError(@"Failed to write output file"));
        return 1;
      }
    } else {
      writeJson(payload);
    }

    return [payload[@"ok"] boolValue] ? 0 : 1;
  }
}
