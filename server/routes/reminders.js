import { crud } from './_business.js'; export const handleReminderRoute=crud('reminders','reminder',['id','title','description','dueAt','completed']);
