---
layout: post
title:  "Notes about ActiveRecord Associations"
date:   2017-02-04 15:02:18 +0000
---

In this post I would like to talk about Associations and corresponding methods in ActiveRecord. It gives us a bunch of prewritten methods to talk with databases and make different associations between the models. I was a little bit confused when I approached it at the first time. I understood plain ORM faster than AR. Big robust libraries are great and give us power. But the main disadvantage is that often we need to spend a lot of time studying its functionality and interfaces. There are some subtle but important principles in ActiveRecord.
Let’s consider simple relationships between Artists and Songs: Artist has many songs and Song belongs to an Artist.
```
class CreateTables < ActiveRecord::Migration
  create_table :artists do |t|
    t.string :name
  end
  create_table :songs do |t|
    t.string :name
    t.string :artist_id
  end
end
```
```
class Artist < ActiveRecord::Base
  has_many :songs
end

class Song < ActiveRecord::Base
  belongs_to :artist
end
```
In this schema an artist is considered as a parent (of songs) and songs are considered as children (of an Artist).

### Creating mutual assocations

So now (when we created tables and defined macros) ActiveRecord gives us a bunch of methods (this is the only thing that it gives us: new methods). We can do the following:
 ```
artist1 = Artist.create(name: “Artist1”)
song1 = Song.create(name: “Song1”)
song1.artist = artist1 
```
Our `song1` is associated with the `artist1` and after typing `song1.artist` we will get `artist1` object. BUT if we type artist1.songs we will get [] – an empty array! We should adhere to the following rule:

**If we tell the child that it belongs to the parent, the parent will not know about that relationship until updating the database. If you tell the parent that a certain child object has been added to its collection, both the parent and the child will always know about the association.**

If you put `song1.save` after that snippet the association will become mutual because song1 will get appropriate artist_id in db. The simplier way to make mutual association is through `artist1.songs << song1`. `#collection<<` is the overridden by ActiveRecord method which makes all necessary associations for us and pushes it into db. BUT there is one more problem concerning efficiency. This method returns ALL artist’s songs from the database and puts it into memory. So if our database has millions of songs then our program can just break or be extremely slow because of lack of memory.
The best way to add mutual associations is to use one of the following methods that return only one object. The first one is `artist.songs.build(name: “Song2”)`. It will build a new instance of a Song class. You can also use `create` instead of `build` to immediately save a new song into database. `#concat` method allows us to add an existing object to the artist’s songs: `artist.songs.concat(song1)`. It will make all associations and push it into db as well.

### Saving of the associated objects

Let’s talk about saving of the associated objects. The problems occur when we try to make associations and then save these objects. Consider two situations:
```
song = Song.new
song.artist = Artist.new
song.save
```
and
```
artist = Song.new.build_artist
artist.save
```
The first snippet will result in 2 SQL statements: both artist and song will be saved in db. But the second one will fire only one SQL statement: the song will not be persisted!  That was really confusing for me until I found the great rule for me. One should consider the following notation to understand it. We say that the object is a parent in the context if it is located on the left of the expression before `.`. So in ` song.artist = Artist.new` song is a parent and we created an Artist from the song in this context. In `artist = Song.new.build_artist` `Song.new` is a parent again. Ok, now the rule:

**Saving the parent will guaranty saving all it's children. The reverse is false.**

In the first snippet we saved parent, hence both parent and child were saved. But in the second snippet we saved child so the parent was not saved. This logic works with has many : has many associations as well.
If you follow this rule you will avoid sudden mistakes in your programs.

### Query caching

The last thing I want to talk about is caching in ActiveRecord. You should be aware of the following:

**Query caching is an ActiveRecord feature that caches the result set returned by each query. If ActiveRecords encounters the same query again for that request, it will use the cached result set as opposed to running the query against database again.**

If your database changes and you query the same request as earlier it will not be updated! Instead it will use the old result. Actually it is cool because it makes your program efficient but you should be aware of it. You can reload the result using `#reload`. When you play with your models in pry or something like this don't forget about it! By the way, in Sinatra and Rails cache lives only during the action. So you need (if you need) to use `#reload` only within the action.

As you can see, there are a lot of subtle but important things which you should be aware of. Hope it was helpful! If you see any misunderstanding please let me know! :)



