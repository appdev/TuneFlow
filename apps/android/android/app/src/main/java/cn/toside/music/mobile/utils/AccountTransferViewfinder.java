package cn.toside.music.mobile.utils;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.util.AttributeSet;
import com.journeyapps.barcodescanner.ViewfinderView;

/** 使用实际识别区域绘制取景框，不显示 ZXing 默认红色光点。 */
public class AccountTransferViewfinder extends ViewfinderView {
  private final Path mask = new Path();
  private final Path corners = new Path();

  public AccountTransferViewfinder(Context context, AttributeSet attrs) { super(context, attrs); }

  @Override public void onDraw(Canvas canvas) {
    refreshSizes();
    Rect frame = framingRect;
    if (frame == null) { postInvalidateDelayed(100); return; }
    float density = getResources().getDisplayMetrics().density;
    float radius = 18 * density;
    mask.rewind();
    mask.setFillType(Path.FillType.EVEN_ODD);
    mask.addRect(0, 0, getWidth(), getHeight(), Path.Direction.CW);
    mask.addRoundRect(frame.left, frame.top, frame.right, frame.bottom, radius, radius, Path.Direction.CW);
    paint.setAntiAlias(true);
    paint.setStyle(Paint.Style.FILL);
    paint.setColor(0x99080D12);
    canvas.drawPath(mask, paint);
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(density);
    paint.setColor(0x66FFFFFF);
    canvas.drawRoundRect(frame.left, frame.top, frame.right, frame.bottom, radius, radius, paint);
    float arm = 30 * density;
    corners.rewind();
    corners.moveTo(frame.left, frame.top + arm);
    corners.lineTo(frame.left, frame.top + radius);
    corners.quadTo(frame.left, frame.top, frame.left + radius, frame.top);
    corners.lineTo(frame.left + arm, frame.top);
    corners.moveTo(frame.right - arm, frame.top);
    corners.lineTo(frame.right - radius, frame.top);
    corners.quadTo(frame.right, frame.top, frame.right, frame.top + radius);
    corners.lineTo(frame.right, frame.top + arm);
    corners.moveTo(frame.right, frame.bottom - arm);
    corners.lineTo(frame.right, frame.bottom - radius);
    corners.quadTo(frame.right, frame.bottom, frame.right - radius, frame.bottom);
    corners.lineTo(frame.right - arm, frame.bottom);
    corners.moveTo(frame.left + arm, frame.bottom);
    corners.lineTo(frame.left + radius, frame.bottom);
    corners.quadTo(frame.left, frame.bottom, frame.left, frame.bottom - radius);
    corners.lineTo(frame.left, frame.bottom - arm);
    paint.setColor(Color.WHITE);
    paint.setStrokeWidth(3 * density);
    paint.setStrokeCap(Paint.Cap.ROUND);
    canvas.drawPath(corners, paint);
    paint.setStyle(Paint.Style.FILL);
  }
}
