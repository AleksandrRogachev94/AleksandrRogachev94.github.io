---
layout: post
title:  Chat Vote Go
date:   2017-05-26 21:42:13 +0000
---


This is my final project at Flatiron school. There were no constraints about this project. The only requirements were to use Rails, React, and Redux.
I decided to make the app where people can connect in private chat rooms, create suggestions for where to go, and vote for the best. All these features must be 'live', which means instant response to all participants of a chat room.

- **About Back End**

Firstly, I started with non-living version of the app to make sure that all was working as expected.

I implemented authentication system using expiring JWT (Javascript Web Token). When users log in to the system, they get unique tokens which represent them. JWT consists of 3 parts: header, payload, and signature to confirm authenticity of this token. In my case I store user id and nickname as payload (note that this information is public and can be used anywhere). After receiving this JWT on the client side, it must include this token in every request under Authorization header. This way the server can determine the user.

When users sign up, they can upload they avatars (with preview on the page). I implemented it using `Amazon S3` storage (as in [Study Helper](http://aleksandr-rogachev-blog.com/2017/04/22/study_helper_part_2/) project).

The main part: users can create private chatrooms and invite other users (guests) in them. Each chatroom consists of 3 parts: chatting itself, managing suggestions, and voting for them. So each chatroom has one owner and many guests (many to many relationships). Each participant can create messages, suggestions, and vote. In order to implement voting mechanism I used `activerecord_reputation_system` gem. It is really helpful.

And now the most interesting part: live chatrooms. I think the best way to implement it is to use `Websockets`. Rails (from Rails 5) created full stack `ActionCable` library (relief that front end part is available independently in npm). It implements all labor-intensive concepts of websockets, so we can easily start developing our own ideas. The main idea of websockets is to create connections between clients and server. After creating these connections server can send (broadcast)  data to all subscribers without requests. In ActionCable implementation, each client can have only one connection (cable) and several channels. Client-side code should make a request to create a cable, and it can subscribe to different channels.

In Chat Vote Go I have 2 types of channels: chatrooms messages and chatrooms suggestions (for each chatroom). So clients can create chatroom messages and suggestions independently. Voting system doesn't need the third channel. Suggestions channel handles it: when clients send voting requests, this channel performs necessary work and broadcasts two suggestions: voted and unvoted.

In order to create connection, server needs to authenticate and authorize a user. So it needs JWT. And here is the problem: websockets don't allow custom headers like Authorization! For now I've made not the best decision: send it as a query in URL. It's not really secure. So I will solve this problem later.

- **About Front End**

This was the hardest part! It was really tough to correctly understand all concepts of Redux. In order to do that I watched all [30](https://egghead.io/courses/getting-started-with-redux) + [27](https://egghead.io/courses/building-react-applications-with-idiomatic-redux) videos (even several times) of Dan Abramov (creator of Redux). They are extremely helpful. So I tried to build Idiomatic Redux. However, my app is not purely Redux: I don't keep ALL data in the store. Some UI variables and form inputs values are stored in local states of components. I think that this is the right decision: Store should care only about shared (between components) and important data.

I tend to normalize data from the server to use it effectively in Redux store. It means, for example, that chatroom object doesn't contain an array of messages object. It contains an array of messages ids. Message is an independent entity (think of it like of database), so it is stored separately from chatrooms in the form of `{ id: messageData }`:

```javascript
{
  1: { message1Data },
  2: { message2Data },
  ...
}
```

This approach to the application simplifies and clarifies programming when it gets really complex and dynamic. I think there are two main benefits: we can easily modify elements without worrying about other entities and we can effectively cache elements for significant performance boost (from the UI point of view). 

So I have 6 main entities in the store:

- auth (contains authentication and ActionCable info)
- users (contains normalized users info)
- chatrooms
- messages
- suggestions
- flashMessages

In my app you can choose chatroom (or user, if you are looking for users) from the list in the sidebar. In Redux store it corresponds to the object with basic info about users (id, title). When you click on a specific chatroom, the app makes a request to the server to get full info. It leads to updating the certain record in chatrooms object. If you go out of this page and than go back, you will instantaneously get chatroom info, because it is cached. However, app still makes a request, in case something changes on the server.

In order to visualize voting results, I use `Recharts` library (based on D3) to show pie chart.

The other important part of Idiomatic Redux is to use Selectors. Your app should not know about the shape of your store. It's the job of reducers. So reducers should have so called selectors, or getters (functions) to obtain certain slices of state or perform some calculations before returning. With the use of selectors you can easily change the shape of your store without touching your components.

When the user logs in, front end app makes a request to establish Websocket connection with server.

After that, if the user visits certain chatroom page, app makes a request to subscribe to 2 channels: chatrooms messages and suggestions. If he/she changes chatroom, app unsubscribes from the current chatroom and subscribes to the new chatroom.

I also want to notice that users can create suggestions in two modes: custom suggestion and search for suggestions. I implemented searching suggestions and getting details about them with Google Places API.

Well, it was a few words about interesting parts of my application. I'm really happy with the results. For now, I haven't found an app with the similar functionality. I hope it can be helpful.

It means that I almost finished Flatiron school! It was really immersive, exciting, and hard. Flatiron is an amazing school. I'm even slightly sad that it comes to the end. But I have to move on and start my carrier! Hope it will give me even more emotions :)

[Github Front End](https://github.com/AleksandrRogachev94/chat-vote-go-frontend)

[Github Back End](https://github.com/AleksandrRogachev94/chat-vote-go-backend)

![chat](https://s3.amazonaws.com/my-docs-bucket/chat.png)

![vote](https://s3.amazonaws.com/my-docs-bucket/vote.png)
