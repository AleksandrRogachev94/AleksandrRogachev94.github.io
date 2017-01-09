---
layout: post
title:  "Auto Service Centers CLI Project "
date:   2017-01-09 05:58:34 -0500
---


In this article I will talk about my CLI project about searching 30 auto service centers near arbitrary zip code. It is based on scraping information from *yellowpages.com* using `nokogiri` gem.
The minimum requirements were the following:

* Make a CLI for interfacing with the application
* Pull data from an external source 
* Implement both list and detail views

First of all, I want to say that scraping data from sites is really tough and sometimes unreliable. For instance, some sites have main information as AJAX, which makes all things complicated. When you open it like `open(url)`, you will not see desired data (i.e. topuniversities.com). Another problem is that some sites have SSL certificate which prevents you from scraping the data (at least doesn’t work for me). So these facts narrow the number of sites for scraping.

Okay, now about my project. I implemented the class named AutoService which stores the data about service center. Also it stores the number of centers in class variable `@@all` and has corresponding class methods.  The important thing is that it has method #details_from_hash which allows to fill instance variables with values from input hash. It uses `sent` method.
 
I made the Scraper class which deals only with scraping data from sites. It has two main scraping methods: `#scrape_centers` and `#scrape_center_details`. The first one scrapes basic information about all centers from the main page. The second one scrapes information about specific center from the url given on the main pagexxxxx. `#scrape_centers` creates objects of AutoService class and adds a few details. `#scrape_center_details` adds details to existing center. They both use #details_from_hash at the end to set center attributes.
	
CLI class is responsible for interaction with user. At the beginning, CLI asks for zip code. After validation it scrapes data, shows the list of center, and gives a menu. 
Menu has 4 options: list all centers, change sorting type (default, distance, rating, name), show details about certain center, and reload data.

To make dynamic url with different zip codes and sorting types, I created URL_TEMPLATE constant to which I append desired parameters when necessary.
	
To make CLI a little bit spicier, I used `colorize` gem to make output strings colored.
Finally, I designed it as a gem and published it on rubygems.org. That was a tough part because it is my first time creating a gem. I learned a lot about how it works. And now I understand that Bundler is really helpful. It makes a lot of stuff for you.

So now you can install and try my gem :) 

Here are links:

[rubygems](https://rubygems.org/gems/auto_service_cli)

[github](https://github.com/AleksandrRogachev94/auto_service_cli_gem)

