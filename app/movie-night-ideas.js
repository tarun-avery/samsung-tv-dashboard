// Initial suggestions. Provider references and runtime notes are in docs/movie-night.md.
(function () {
  'use strict';
  var services = {
    netflix:['org.tizen.netflix-app','Netflix'],
    paramount:['rJyOSqC6Up.PPlusIntl','Paramount+'],
    crunchyroll:['OGLLvqej7u.CrunchyrollWebApp','Crunchyroll'],
    prime:['evKhCgZelL.AmazonIgnitionLauncher2','Prime Video'],
    apple:['Y6A54cEa22.AppleTV','Apple TV'],
    disney:['MCmYXNxgcu.DisneyPlus','Disney+']
  };
  var entries = [
    ['mitchells','The Mitchells vs. the Machines','netflix','film',114],
    ['wednesday','Wednesday','netflix','series',59],
    ['transformers','Transformers','paramount','film',144],
    ['strange-new-worlds','Star Trek: Strange New Worlds','paramount','series',53],
    ['jujutsu-kaisen-zero','JUJUTSU KAISEN 0','crunchyroll','film',105],
    ['frieren',"Frieren: Beyond Journey's End",'crunchyroll','series',24],
    ['vast-of-night','The Vast of Night','prime','film',90],
    ['fallout','Fallout','prime','series',74],
    ['wolfwalkers','Wolfwalkers','apple','film',102],
    ['ted-lasso','Ted Lasso','apple','series',31],
    ['encanto','Encanto','disney','film',114],
    ['bluey','Bluey','disney','series',8]
  ];
  window.dashboardMovieNightIdeas = entries.map(function (item) {
    var service = services[item[2]];
    return {id:'idea-'+item[0],title:item[1],service:{id:service[0],name:service[1]},
      kind:item[3],minutes:item[4],season:1,episode:1,finished:false};
  });
}());
