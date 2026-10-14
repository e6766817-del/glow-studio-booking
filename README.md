# Glow Studio – לוח תורים

מערכת ניהול תורים פנימית לקוסמטיקאית. הלקוחה מתקשרת טלפונית, והקוסמטיקאית קובעת
את התור במערכת. כל בוקר נשלח אליה מייל אוטומטי עם לוח התורים של אותו היום.

- **אתר חי:** ראו GitHub Pages של המאגר הזה.
- **אפיון מלא:** מסמך אפיון נפרד (קישור נמסר בנפרד).
- **בסיס נתונים:** Supabase (Postgres + Auth + RLS) – ראו `supabase/schema.sql`.
- **מייל יומי אוטומטי:** Supabase Edge Function + pg_cron + Resend – ראו `supabase/functions/daily-schedule-email`.
- **מסך חובות ותזכורות:** תשלומים שלא בוצעו, עם תזכורת במייל ללקוחה מיד עם רישום החוב ואז כל שבוע עד
  לסימון כשולם – ראו `supabase/functions/debt-reminders`.

## מבנה הפרויקט

```
index.html                                   אתר הניהול (Vue 3 + supabase-js)
supabase/schema.sql                           טבלאות, נתוני זרע, RLS
supabase/add-debts.sql                        הוספת טבלת החובות לפרויקט קיים
supabase/schedule-cron.sql                    תזמון המייל היומי ותזכורות החובות (pg_cron)
supabase/functions/daily-schedule-email/      פונקציית ה-Edge ששולחת את המייל
supabase/functions/debt-reminders/            פונקציית ה-Edge ששולחת תזכורות על חובות
```

## הפעלת מסך החובות

הקוד כבר באתר; צריך להריץ פעם אחת את החלקים שבצד השרת:

1. להריץ את `supabase/add-debts.sql` ב-SQL editor של Supabase (יוצר את טבלת `debts`).
2. לפרוס את הפונקציה: `supabase functions deploy debt-reminders`
   (משתמשת באותם secrets של Resend כמו הדוח היומי).
3. לתזמן את הסריקה היומית – הבלוק של `debt-reminders` ב-`supabase/schedule-cron.sql`.

עד שלב 1 המסך יוצג ריק; שאר המערכת עובדת כרגיל. תזכורות נשלחות רק ללקוחות
שרשומה להן כתובת מייל.

## הרצה מקומית

הקובץ `index.html` הוא עמוד סטטי יחיד (ללא build step). פותחים אותו בדפדפן, או
משרתים אותו בכל שרת סטטי. מפתח ה-Supabase ב-`index.html` הוא מפתח anon ציבורי –
בטוח לחשיפה, כל ההרשאות נאכפות ב-Row Level Security בצד השרת.
