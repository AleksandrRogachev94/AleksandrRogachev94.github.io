---
layout: post
title:      "Showing Online Users with Socket.io without persistence"
date:       2018-10-01 20:04:56 -0400
permalink:  showing_online_users_with_socket_io_without_persistence
---


In this post I would like to discuss the implementation of how to keep track of online users with their meta data in front end in a specific room without any database manipulations in back end. I needed this functionality in Angular app but I did not want to add additional complexity in backend, such as new table in SQL database and it's management. Furthermore, I was not sure what data I needed to save back then, it would be more than just status, so I would have to use some temporary non SQL blobby field. I googled it and could not find any solution, all of them involve persistence, so I implemented it by myself. I hope this article will be helpful to those who faced the same problem.



Note that everything below is a slightly simplified version of what you would actually use. For example, in real world we use authentication and authorization. But I want to keep it simple here. Also note that socket.io object in backend keeps track of all connected clients, but it contains just socket ids, which is not enough, we want our custom data.

Before diving in implementation details, this is the general flow outlined:

1) When user attempts to connect to a room, frontend emits `JOIN` event to backend.

2 ) When backend receives `JOIN` event, it connects this new user to the room. But it also does 2 more things: a) asks all clients connected to the same room to report their data (e.g. email and status) by *broadcasting* `REPORT_REQUEST` event; b) saves unique user's property, such as user id to `socket` object to retrieve it later (see *6*)

3) All clients connected to the same room receive `REPORT_REQUEST` event. As a response they emit `REPORT` event with their data (e.g. email and status) and room id.

4) When Backend receives `REPORT` event, it *broadcasts* `ADD_USER` event with provided data to all room's participants except the one that emitted it (uses provided room id).

5) Finally, all room's participants receive `ADD_USER` event with meta data and saves the corresponding user to an array (but be careful, avoid duplicates)

6) When user leaves app or room, backend receives `DISCONNECTING` event (you can also implement `LEAVE` event). At this moment in time, backend retrieves user id from `socket` object (see *1*) and *broadcasts* `REMOVE_USER` event along with user id to each room that user was participating.



This flow assures that all clients are always up-to-date with each other.



All right, so I outlined all major steps. Now let's dive in to code details in Backend and Frontend separately. Note that I use typescript everywhere, but it can be easily converted to raw javascript.



**Backend**

Let's start with backend

I define a service `SocketsService`:

```typescript
import * as socketIO from 'socket.io';

export class SocketsService {
  private io:SocketIO.Server

  constructor(io:SocketIO.Server) {
    this.io = io
    this.setListeners()
  }
  
  setListeners():void {
    // TODO
  }
}
```

First of all, external code should provide initialized `io` instance of `socketIO`  during service initialization. After that, we should set event listeners in `setListeners()`.  We will listen to 4 events here: `CONNECTION`, `DISCONNECTING`, `JOIN`, `REPORT`:

```typescript
setListeners() {
  this.io.on("connection", (socket:SocketIO.Socket) => {
    socket['userId'] = socket.handshake.query['userId'] // set userId provided as a query parameter.

    socket.on("disconnecting", this.handleDisconnecting.bind(this, socket))
    socket.on("JOIN", this.handleJoin.bind(this, socket))
    socket.on("REPORT", this.handleReport.bind(this, socket))
  });
}
```

Note that when user connects, we set unique `userId` provided from frontend as a query parameter to the `socket` instance. In case you are concerned about multiple instances of your web app, I wrote a note about it at the end of this article.

In this code when user connects we set all the other event listeners. I define handlers and bind them to accept `socket` parameter for current connection.

Let's take a closer look at these handlers:

```typescript
handleJoin(socket:SocketIO.Socket, roomId):void {
  socket.join(roomId); // join the room
  this.ui.to(roomId).emit("REPORT_REQUEST") // ask everyone to report their data.
}

handleReport(socket:SocketIO.Socket, report:{ roomId:string, data:any }):void {
  // Backend does not care what data we provide to other clients, it's just a proxy here, so the type of data is `any`. It can be, for example, username, email, and status.
  socket.broadcast.to(report.roomId).emit("ADD_USER", report.data) // Emit ADD_USER to all participants of the room.
}

handleDisconnecting(socket:SocketIO.Socket):void {
  // broadcast REMOVE_USER to each room this user is currently in.
  Object.keys(socket.rooms).forEach((room:string) => {
    if(room !== socket.id) socket.broadcast.to(room).emit("REMOVE_USER", socket['userId'])
  })
}
```

It follows the flow that I described above. So it uses 3 more events: `REPORT_REQUEST`, `ADD_USER`, `REMOVE_USER`. Note that we provide `userId` saved on a `socket` instance (when user connected) in `REMOVE_USER` event.



**Frontend**

Things are slightly more complicated in Frontend. First of all, we need to implement `UsersService` that will store and handle adding, removing, and updating online users. It's up to you, but in this example I will provide a very simple version of it (in real life you would probably want to use pub/sub to subscribe to users array changes):

```typescript
export interface User {
  userId:string
  email:string
  status:string
}

export class UsersService {
  private users:Array<User> = []
  
  addUser(user:User) {
    // add users with new userId only.
    if(!!this.users.find(u => u.userId === user.userId)) return;

    this.users.push(user)
  }
  
  removeUser(userId:string) {
    this.users = this.users.filter(user => user.userId !== userId)
  }

  findUser(userId:string):User {
    return this.users.find(user => user.id === id)
  }
  
  getUsers():Array<User> {
    return this.users.slice()
  }

  clear() {
    this.users = []
  }
  
}
```



Now we are ready to define `SocketsService` in frontend:

```typescript
import * as io from 'socket.io-client'
import { User, UsersService } from './users.service'

export class SocketsService {
  roomId:string
  user:User
  
  usersService = new UsersService() // instantiate UsersService.
  
  socket:SocketIOClient.Socket // socket.io instance
  
  connected():boolean {
    return !!this.socket
  }
  
  // Connects to socket.io server and to a specific room.
  connect(user:User, roomId:string):Promise<SocketsService> {
    if(!roomId || !user) throw new Error("Provided Invalid Data to connect")
    if(this.connected()) this.disconnect() // if already connected, disconnect

    // First of all, connect to socket.io server
    // NOTE specify your socketUrl.
    this.socket = io(environment.socketUrl, {
      query: { userId: user.userId }
    })

    // Set general listeners - connect, disconnect
    return this.setGeneralListeners()
      .then(_ => {
        return new Promise((resolve, reject) => {
          // Now connect to a room.
          this.socket.emit("JOIN", { roomId: roomId }, (err) => {
          if (err) {
            reject(err)
          } else {
            this.roomId = roomId; this.user = user
            this.usersService.addUser(this.user) // add current user.
            this.setRoomListeners() // set room specific listeners
            resolve(this)
          }
        })
      });
    })
  }

  // Disconnect from socket.io server.
  disconnect() {
    this.socket && this.socket.disconnect()
    this.socket = null; this.user = null; this.roomId = null

    this.usersService.clear()
  }
  
  // %%%%%%%%%%%%%%%%%%%%%PRIVATE METHODS%%%%%%%%%%%%%%%%%%%%%%%%%
  
  // Set general listeners - connect, disconnect.
  private setGeneralListeners():Promise<SocketsService> {
    if(!this.socket) return;

    this.socket.on("disconnect", () => {
      // NOTE when something goes wrong, e.g. bad internet connection, so it reconnects.
      if(this.socket && this.user && this.roomId) {
        this.usersService.clear()
      }
    });

    return new Promise((resolve, reject) => {
      this.socket.on("connect", () => {
        // NOTE when something goes wrong, e.g. bad internet connection, so it reconnects.
        if(this.user && this.roomId) {
          this.connectToRoom(this.roomId, this.user)
          this.socket.emit("REPORT", { roomId: this.roomId, user: this.user })
        }

        resolve(this)
      });
    })

  }
  
  // Set listeners related to a room.
  private setRoomListeners() {
    if(!this.socket || !this.roomId) return;

    this.socket.on("REPORT_REQUEST", () => {
      this.socket.emit("REPORT", { roomId: this.roomId, user: this.user })
    })

    this.socket.on("ADD_USER", (user:User) => {
      this.usersService.addUser(user)
    })

    this.socket.on("REMOVE_USER", (userId:string) => {
      this.usersService.removeUser(userId)
    })
  }

}
```



I hope this code is self-explanatory. Again, it follows the flow that I described. There are a few subtleties, like in `setGeneralListeners` - in case client suddenly disconnects and then reconnects, it handles it properly and connects to the previous room. Note that I keep `user` and  `roomId` in this service.

In your app you would use this service like this:

```typescript
import { SocketsService } from './sockets.service'

const socketsService = new SocketsService()
// Connect to socket.io server to a room
socketsService.connect({
  userId: "userid"
  status: "online",
  email: "email"
}, 'roomid')
  .then(_ => {
    console.log("good to go")
  	console.log(socketsService.usersService.getUsers())
  })
  .catch(err => {
  	console.log(err)
  })
```



## Conclusions

As you can see, there is not much code in backend, but it’s much more code in frontend. That’s fine since I need online users management system only in frontend, so most of the logic should be there. And Backend is kept light, just what I wanted. What is important, I avoided persisting any information. Moreover, you can easily add additional operations for clients to communicate, basically using backend as a proxy with just a few lines of code. So I hope this post was helpful and it’s not too much code.



I intentionally skipped some details in the code to make it simpler in this post. If you have difficulties in trying to implement it, let me know and I'll add more details.



P.S.

1) Regarding concerns about multiple instances of the app. As you can see, socket objects and `userId` in them are stored in memory on a specific machine. But it's not a big deal. Socket.IO provides a package https://github.com/socketio/socket.io-redis that uses `redis` to synchronize all instances with just a few lines of code. So with this package this approach works with multiple instances just fine.

2) There is a chance that you (like me) might want to allow one user to have multiple devices/tabs to be opened in the same room at the same time. In order to do it, instead of using `userId`, you can generate unique `clientId` on each client and use it instead. In this case we allow users with the same `userId` to be stored in users list but require uniqueness of `clientId`.
