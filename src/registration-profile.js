'use strict';
const { cleanString, requireObject } = require('./validation');
const { assert } = require('./errors');

function registrationProfile(value, role) {
  const body = requireObject(value, 'Profile');
  const required = (key, max) => cleanString(body[key], key, { min: 1, max });
  const profile = {
    department: required('department', 80),
    phone: cleanString(body.phone ?? '', 'phone', { max: 25 }),
    register_number: '', program: '', section: '', academic_year: '', employee_id: '', designation: '',
  };
  assert(!profile.phone || /^\+?[0-9 ()-]{7,25}$/.test(profile.phone) && profile.phone.replace(/\D/g, '').length >= 7, 400, 'validation_error', 'Enter a valid phone number or leave it blank.', { field: 'phone' });
  if (role === 'student') {
    profile.register_number = required('register_number', 50);
    profile.program = cleanString(body.program ?? '', 'program', { max: 80 });
    profile.section = required('section', 30);
    profile.academic_year = required('academic_year', 30);
  } else {
    profile.employee_id = required('employee_id', 50);
    profile.designation = required('designation', 80);
  }
  return profile;
}
module.exports = { registrationProfile };
