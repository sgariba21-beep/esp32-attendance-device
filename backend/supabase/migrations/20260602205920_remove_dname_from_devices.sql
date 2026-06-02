alter table devices drop column dname;

alter table devices 
  add constraint devices_class_form_unique unique (class, form);