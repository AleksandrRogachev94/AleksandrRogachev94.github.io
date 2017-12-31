---
layout: post
title:      "Redux in Angular with ngrx package"
date:       2017-12-31 19:00:22 +0000
permalink:  redux_in_angular_with_ngrx_package
---


In my current job I'm working closely with redux pattern in Angular. We decided to use it, to use centralized data store (aka front end database) because it gives a lot of advantages and abilities, including clear data flow and simplified debugging since it uses single source of truth, effective data caching to improve user experience. It also gives a way to implement robust offline mode since essentially we save our data in "frontend database", single source of truth. 

Redux is a design pattern that was created by Dan Abramov to simplify Facebook team's `Flux` pattern that is slightly more complicated. For example, Flux suggests to use multiple data stores. Redux uses only one multipurpose data store. It allows to simplify Flux pattern and remove several components (such as dispatchers). But even after these simplifications Redux is relatively hard to understand. It requires large amount of time to understand and write correct, effective, and idiomatic Redux code. In this post I would like to talk about the main concepts of Redux, gotchas that were not obvious for me when I just started using it but are very important, and best coding practices. Here I will be talking about Redux in Angular, but most of my logic is still applicable for React Redux since it's the same idea.

Initially redux came from React. Dan created a package for React that implements it. But eventually it became so popular that some other frameworks implemented it as well. Specifically, it was implemented in Angular and was called `ngrx`. It utilizes exactly the same patterns and logic, but also uses the benefits of Angular and Typescript, so in the end it's slightly different.

Okay, now to recap let's talk briefly about how it works. 

![image](https://s3.amazonaws.com/my-docs-bucket/redux.png)

Basically, Redux needs 4 main parts to work: Actions, Reducers, Store, View. Let's consider the following example to demonstrate their tasks. Let's **imagine** a Post Page - this is the `View`. On this page we want to create new comments and save them in our global `Store` - just plain javascript object. In order to do that we dispatch an `Action` in our code of the `View`, which is just a javascript method: `AddComment({ username: 'anonimous', content: 'awesome post!' })`. We define all actions ourselves. Actions generally have a type and a payload, e.g. comment's content.  ngrx listens to all registered actions and when it recognizes that out action was dispatched, it will change the store correspondingly. In our case, it should add a comment in some place. Now, how does it know how to respond to this action, where to put this comment? Via reducers. Reducers are pure functions that take the previous State and an Action and return the next, updated State. In our case, the next state is the previous state with one additional comment added. It is important to understand that reducers define the structure of the Store. You define multiple Reducers for multiple features, such as comments, posts, claps...

There are a lot of things to be considered when talking about reducers and store's shape. This post is not about it though. You can read about it, for example, [here](https://redux.js.org/docs/basics/Reducers.html) and [here](https://redux.js.org/docs/recipes/reducers/NormalizingStateShape.html). I would just advice to you to design your store to be `normalized`, think about it as a real database, just a little bit simplified. Also, we use nested reducers, so in our simplified example we would have the following reducers structure:

```javascript
indexReducer = {
  postsReducer: {
    postsByIdReducer: {
      post: postReducer
    },
    allPosts: postsListReducer
  },
  
  commentsReducer: {
    commentsByIdReducer: {
      comment: commentReducer,
    },
    allComments: commentsListReducer
  }
}
```

Each feature has it's own reducer.

Now let's talk about some important details that you should know. First of all, `reducers must be pure functions`. It means that they shouldn't mutate the store. For every invocation they should create a new store based on the previous store. For example, this reducer is destructive:

```javascript
// DON'T DO IT!
...
function commentsByIdReducer(state = {[id:string]: Comment}, action:CommentsActions) {
  switch(action.type)
  ...
  case ADD_COMMENT:
    state[action.comment.id] = action.comment
    return state
  ...
}
```

This example mutates the state. It is a bad pattern. On the other hand, this example is correct:

```javascript
...
function commentsByIdReducer(state = {[id:string]: Comment}, action:CommentsActions) {
  switch(action.type)
  ...
  case ADD_COMMENT:
    return {
        ...state,
        [action.comment.id]: action.comment
    }
  ...
}
```

Each action should create a new store that does not depend on the previous state. This is needed for a few reasons. One of them is that Redux requires it to work correctly and efficiently. The other reason is that in this case we can view the whole history of our state, each actions, store diff, etc. Sounds reasonable, right? What was NOT obvious for me is **what we should do if some part was not changed in the store**. So, for example, we add a new comment, but it's post itself was not changed. What should we do with this post's part of the store? Sometimes I was confused about it and in some cases (not as clear and simple as this example) tried to manually create a new deep copied object. But eventually I found and realized that it is not required at all, and even bad. There is **nothing bad in copying just object's reference if this object was not changed!** It is an absolutely valid operation. So if this object `example = { a: { b: [1,2,3], c: {h: "hello world" }}}` was not changed during some action, you can take just `example` reference and copy this reference to a new store. And by the way, this is what you actually do in reducer's default statement of `switch` (`default: return state;`).

Now, about getting parts of a store in the View. Basically, we want our store and it's structure to be abstracted away as much as possible, so we can easily change it without touching the other code (e.g. View). We can accomplish it via **selectors**. This is just getters for certain parts of a store. Each reducer should has it's own selectors (e.g. `getIsFetchingComment()`). Than in a parent reducer we define selectors with the same names that call corresponding selectors from child reducers. So eventually we propagate it up to the root reducer. In this case only a reducer that handles a certain feature knows how to get it, then this selector is propagated to the root reducer. So we have all our selectors aggregated in the root reducer. So when you import them in the View, you import them from a single file. You View is not aware of the internal structure of your store at all. It just uses something like `getIsFetchingComment(state, id)`.

Okay, now we have selectors, but how would we use in our View? ngrx provides a method called `store.select()`. You can pass it a function that will receive global state of a store and return a part of it. This is exactly what selectors do. In a simple case where you don't have additional parameters, you can call it like this:

```javascript
store.select(getIsAuthenticated)
```

But in the other case, where, for example, you need to get a comment by id, you need to do the following hack:

```javascript
const id = '1'
store.select((state:AppState) => getCommentById(state, id))
```

`store.select` returns an observable. Every time our comment changes, it will emit a new value. You can simply subscribe to this Observable by calling `.subscribe()`.

Now it's **important to understand** the following: every time you update any part of a store, **the whole store will be updated** (we do it in reducers, which are pure function). It means that every time you update, for example, post's name, all your comments (that was not changed) will be emitted as well to subscribers. It will trigger rerendering of the View. Of course, it's bad and can slow down your app. How can we solve it?

ngrx is smart. `store.select` does not return just a simple Observable. Under the hood `store.select` calls `distinctUntilChanged` on the initial observable. This is the method that can be called on an Observable. It returns a new Observable that keep track of a previously emitted value. It will not emit a new value if it was not changed. This is exactly what we need. Thanks ngrx!

However, there is one more thing you need to understand. If you perform some calculations in your selectors, like creating and returning new arrays, it will always emit a new value, even if it's an array of the same objects (you still created a new array, new reference). You must keep it in mind. If you perform heavy operations, they will rerun if you change any part of a store.

Well, actually there is a solution for this case. There is a library called **[reselect](https://github.com/ngrx/platform/blob/master/docs/store/selectors.md)**. It creates selectors wrappers for you and keeps track of arguments that your selectors was called with. If it's the same, it will do nothing. However, I've not found how to pass additional arguments to these selectors. It's crucial for us, we want to get a comment with an id, we want to pass it as a parameter. But it seems like you can't do it it reselect. Please correct me if I'm wrong here!

Let's move on.  Let's talk about redux related operations that perform side effects, such as async requests to a server. In our example it would be sending our comment to a server. In React's Redux we should create a separate action function that is not pure and dispatches different actions in different moments of time. So we basically treat it as a normal action that is not actually correct. And you just dispatch these 'actions' in your View. Angular's ngrx is slightly different in this matter, I like this pattern more. It has so called effects. These effects are separate functions, but NOT ACTIONS. Basically, you write an effect that listens to a certain action. When this action occurs, the effect triggers and dispatches more actions in the end. For example, let's consider the following actions (it is a good pattern): `AddCommentRequest`, `AddCommentSuccess`, `AddCommentFailure`. Each of them changes some part in Redux store, including metadata such as `isFetching` or `errors` From the View we dispatch only one plain action: `AddCommentRequest`. We write an effect that will listen to this action, and when it occurs, it makes AJAX request to a server. On success it dispatches `AddCommentSuccess`, on failure - `AddCommentFailure`. This is a good clean pattern to handle it like that. Implementing effects requires relatively deep knowledge of **Observables**. So I strongly recommend you to study it thoroughly before writing your effects, for example, operations like `switchMap` and `mergeMap`.

Okay, that's it for this post. It's just a few things. Redux is a complicated beast to implement. Keep sharpening your skills and improve your understanding! And of course, learn Observables :)




