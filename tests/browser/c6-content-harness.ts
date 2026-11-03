import { createC6CourseRepository } from '../../web/src/content/c6-course-repository';
import { validateCompleteC6Course } from '../../web/src/content/c6-course-validator.mjs';
import type { C6CourseRepository } from '../../web/src/content/c6-course-repository';

const content = {
  create: createC6CourseRepository,
  validate: validateCompleteC6Course,
  repository: createC6CourseRepository(),
};
declare global {
  interface Window {
    c6Content: typeof content;
    c6Pending?: Promise<string>;
    c6Other?: C6CourseRepository;
  }
}
window.c6Content = content;
