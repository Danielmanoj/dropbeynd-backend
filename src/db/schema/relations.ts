import { relations } from "drizzle-orm";
import { usersTable } from "./users";
import { creatorsTable } from "./creators";
import { postsTable } from "./posts";
import { coursesTable, lessonsTable } from "./courses";
import { subscriptionsTable } from "./subscriptions";
import { paymentsTable, paymentMethodsTable, payoutAccountsTable } from "./payments";
import { bookmarksTable } from "./bookmarks";
import { courseProgressTable } from "./courseProgress";
import { followsTable } from "./follows";
import { commentsTable } from "./comments";
import { storiesTable } from "./stories";
import { likesTable } from "./likes";
import { reportsTable } from "./reports";
import { tipsTable } from "./tips";
import { ticketsTable } from "./tickets";
import { messagesTable } from "./messages";
import { verificationsTable } from "./verifications";
import { notificationsTable } from "./notifications";

export const usersRelations = relations(usersTable, ({ one, many }) => ({
  creator: one(creatorsTable, {
    fields: [usersTable.id],
    references: [creatorsTable.userId],
  }),
  subscriptions: many(subscriptionsTable),
  payments: many(paymentsTable),
  paymentMethods: many(paymentMethodsTable),
  payoutAccounts: many(payoutAccountsTable),
  bookmarks: many(bookmarksTable),
  courseProgress: many(courseProgressTable),
  follows: many(followsTable),
  comments: many(commentsTable),
  likes: many(likesTable),
  reports: many(reportsTable, { relationName: "reporter" }),
  tipsSent: many(tipsTable, { relationName: "tipper" }),
  notifications: many(notificationsTable),
}));

export const notificationsRelations = relations(notificationsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [notificationsTable.userId],
    references: [usersTable.id],
  }),
  creator: one(creatorsTable, {
    fields: [notificationsTable.creatorId],
    references: [creatorsTable.id],
  }),
}));

export const creatorsRelations = relations(creatorsTable, ({ one, many }) => ({
  user: one(usersTable, {
    fields: [creatorsTable.userId],
    references: [usersTable.id],
  }),
  posts: many(postsTable),
  courses: many(coursesTable),
  subscriptions: many(subscriptionsTable),
  payments: many(paymentsTable),
  payoutAccounts: many(payoutAccountsTable),
  followers: many(followsTable),
  stories: many(storiesTable),
  tips: many(tipsTable, { relationName: "tipped_creator" }),
}));

export const postsRelations = relations(postsTable, ({ one, many }) => ({
  creator: one(creatorsTable, {
    fields: [postsTable.creatorId],
    references: [creatorsTable.id],
  }),
  bookmarks: many(bookmarksTable),
  comments: many(commentsTable),
}));

export const coursesRelations = relations(coursesTable, ({ one, many }) => ({
  creator: one(creatorsTable, {
    fields: [coursesTable.creatorId],
    references: [creatorsTable.id],
  }),
  lessons: many(lessonsTable),
}));

export const lessonsRelations = relations(lessonsTable, ({ one, many }) => ({
  course: one(coursesTable, {
    fields: [lessonsTable.courseId],
    references: [coursesTable.id],
  }),
  progress: many(courseProgressTable),
}));

export const subscriptionsRelations = relations(subscriptionsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [subscriptionsTable.userId],
    references: [usersTable.id],
  }),
  creator: one(creatorsTable, {
    fields: [subscriptionsTable.creatorId],
    references: [creatorsTable.id],
  }),
}));

export const paymentsRelations = relations(paymentsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [paymentsTable.userId],
    references: [usersTable.id],
  }),
  creator: one(creatorsTable, {
    fields: [paymentsTable.creatorId],
    references: [creatorsTable.id],
  }),
}));

export const bookmarksRelations = relations(bookmarksTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [bookmarksTable.userId],
    references: [usersTable.id],
  }),
  post: one(postsTable, {
    fields: [bookmarksTable.postId],
    references: [postsTable.id],
  }),
}));

export const courseProgressRelations = relations(courseProgressTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [courseProgressTable.userId],
    references: [usersTable.id],
  }),
  lesson: one(lessonsTable, {
    fields: [courseProgressTable.lessonId],
    references: [lessonsTable.id],
  }),
}));

export const followsRelations = relations(followsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [followsTable.userId],
    references: [usersTable.id],
  }),
  creator: one(creatorsTable, {
    fields: [followsTable.creatorId],
    references: [creatorsTable.id],
  }),
}));

export const commentsRelations = relations(commentsTable, ({ one, many }) => ({
  user: one(usersTable, {
    fields: [commentsTable.userId],
    references: [usersTable.id],
  }),
  post: one(postsTable, {
    fields: [commentsTable.postId],
    references: [postsTable.id],
  }),
  replies: many(commentsTable, { relationName: "comment_replies" }),
  parent: one(commentsTable, {
    fields: [commentsTable.parentId],
    references: [commentsTable.id],
    relationName: "comment_replies",
  }),
}));

export const storiesRelations = relations(storiesTable, ({ one }) => ({
  creator: one(creatorsTable, {
    fields: [storiesTable.creatorId],
    references: [creatorsTable.id],
  }),
}));

export const likesRelations = relations(likesTable, ({ one }) => ({
  user: one(usersTable, { fields: [likesTable.userId], references: [usersTable.id] }),
  post: one(postsTable, { fields: [likesTable.postId], references: [postsTable.id] }),
}));

export const reportsRelations = relations(reportsTable, ({ one }) => ({
  reporter: one(usersTable, {
    fields: [reportsTable.userId],
    references: [usersTable.id],
    relationName: "reporter",
  }),
}));

export const tipsRelations = relations(tipsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [tipsTable.userId],
    references: [usersTable.id],
    relationName: "tipper",
  }),
  creator: one(creatorsTable, {
    fields: [tipsTable.creatorId],
    references: [creatorsTable.id],
    relationName: "tipped_creator",
  }),
}));

export const ticketsRelations = relations(ticketsTable, ({ one }) => ({
  user: one(usersTable, { fields: [ticketsTable.userId], references: [usersTable.id] }),
}));

export const messagesRelations = relations(messagesTable, ({ one }) => ({
  sender: one(usersTable, { fields: [messagesTable.senderId], references: [usersTable.id], relationName: "msg_sender" }),
  receiver: one(usersTable, { fields: [messagesTable.receiverId], references: [usersTable.id], relationName: "msg_receiver" }),
}));

export const verificationsRelations = relations(verificationsTable, ({ one }) => ({
  creator: one(creatorsTable, { fields: [verificationsTable.creatorId], references: [creatorsTable.id] }),
  requestedBy: one(usersTable, { fields: [verificationsTable.requestedById], references: [usersTable.id] }),
}));

export const paymentMethodsRelations = relations(paymentMethodsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [paymentMethodsTable.userId],
    references: [usersTable.id],
  }),
}));

export const payoutAccountsRelations = relations(payoutAccountsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [payoutAccountsTable.userId],
    references: [usersTable.id],
  }),
  creator: one(creatorsTable, {
    fields: [payoutAccountsTable.creatorId],
    references: [creatorsTable.id],
  }),
}));

